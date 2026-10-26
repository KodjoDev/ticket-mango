import { actor, describeDb, resetDb, setup, teardown, type TestContext } from './helpers';

describeDb('crise P0/P1', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.devCalls.length = 0;
    ctx.respond.current = () => ({});
  });

  async function withChannels() {
    const admin = await actor(ctx, 'ADMIN');
    const slack = await admin.post('/admin/alert-channels', { kind: 'SLACK', name: 'Astreinte', target: 'https://hooks.slack.com/services/T0/B0/secret' });
    const pd = await admin.post('/admin/alert-channels', { kind: 'PAGERDUTY', name: 'PagerDuty', target: 'cle-pagerduty-123' });
    expect(slack.statusCode).toBe(201);
    expect(pd.statusCode).toBe(201);
    return { admin, slack: slack.json(), pd: pd.json() };
  }

  it('chiffre la destination d’alerte, ne la renvoie jamais et refuse une URL non https', async () => {
    const { admin, slack } = await withChannels();
    expect(JSON.stringify(slack)).not.toContain('secret');
    expect(slack).toMatchObject({ kind: 'SLACK', hasTarget: true });
    const raw = await ctx.prisma.alertChannel.findUniqueOrThrow({ where: { id: slack.id } });
    expect(raw.targetEnc).not.toContain('hooks.slack.com');
    expect((await admin.post('/admin/alert-channels', { kind: 'TEAMS', name: 'x', target: 'http://insecure.local' })).statusCode).toBe(400);
    const n2 = await actor(ctx, 'AGENT_N2');
    expect((await n2.get('/admin/alert-channels')).statusCode).toBe(403);
  });

  it('réserve l’ouverture d’un incident à incident:manage', async () => {
    const n1 = await actor(ctx, 'AGENT_N1');
    const n2 = await actor(ctx, 'AGENT_N2');
    const body = { title: 'API indisponible', severity: 'P0', message: 'Nous enquêtons.' };
    expect((await n1.post('/incidents', body)).statusCode).toBe(403);
    expect((await n1.get('/incidents')).statusCode).toBe(200);
    expect((await n2.post('/incidents', { ...body, severity: 'P3' })).statusCode).toBe(400);
    expect((await n2.post('/incidents', body)).statusCode).toBe(201);
  });

  it('ouvre un incident : alerte Slack et PagerDuty, notification du support, audit', async () => {
    await withChannels();
    const n2 = await actor(ctx, 'AGENT_N2');
    const n1 = await actor(ctx, 'AGENT_N1');
    const res = await n2.post('/incidents', { title: 'API indisponible', severity: 'P0', message: 'Nous enquêtons.' });
    expect(res.statusCode).toBe(201);
    const incident = res.json();
    expect(incident).toMatchObject({ status: 'INVESTIGATING', severity: 'P0' });
    expect(incident.updates).toHaveLength(1);

    const slackCall = ctx.devCalls.find((c) => c.url.startsWith('https://hooks.slack.com'));
    expect((slackCall!.body as { text: string }).text).toContain('[P0] Incident ouvert — API indisponible');
    const pdCall = ctx.devCalls.find((c) => c.url === 'https://events.pagerduty.com/v2/enqueue');
    expect(pdCall!.body).toMatchObject({ routing_key: 'cle-pagerduty-123', event_action: 'trigger', dedup_key: incident.id, payload: { severity: 'critical' } });
    expect(incident.deliveries.map((d: { ok: boolean }) => d.ok)).toEqual([true, true]);

    const { items } = (await n1.get('/notifications')).json();
    expect(items[0].message).toContain('API indisponible');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'incident.opened' } })).toBe(1);
  });

  it('journalise une alerte en échec sans bloquer l’incident', async () => {
    await withChannels();
    ctx.respond.current = () => null; // les destinations répondent 404
    const n2 = await actor(ctx, 'AGENT_N2');
    const res = await n2.post('/incidents', { title: 'Panne', severity: 'P1', message: 'Panne en cours.' });
    expect(res.statusCode).toBe(201);
    expect(res.json().deliveries.every((d: { ok: boolean; error: string }) => !d.ok && d.error.includes('404'))).toBe(true);
  });

  it('suit les statuts, n’envoie à PagerDuty que la résolution et verrouille un incident résolu', async () => {
    await withChannels();
    const n2 = await actor(ctx, 'AGENT_N2');
    const { id } = (await n2.post('/incidents', { title: 'Panne', severity: 'P1', message: 'Début.' })).json();
    ctx.devCalls.length = 0;

    expect((await n2.post(`/incidents/${id}/updates`, { status: 'FIXING', message: 'Correctif en cours.' })).statusCode).toBe(200);
    expect(ctx.devCalls.map((c) => new URL(c.url).hostname)).toEqual(['hooks.slack.com']);

    ctx.devCalls.length = 0;
    const done = (await n2.post(`/incidents/${id}/updates`, { status: 'RESOLVED', message: 'Rétabli.' })).json();
    expect(done.status).toBe('RESOLVED');
    expect(done.resolvedAt).not.toBeNull();
    expect(ctx.devCalls.find((c) => c.url.includes('pagerduty'))!.body).toMatchObject({ event_action: 'resolve', dedup_key: id });
    expect((await n2.post(`/incidents/${id}/updates`, { status: 'FIXING', message: 'Encore' })).statusCode).toBe(409);
  });

  it('expose la status page sans connexion, sans données internes', async () => {
    const n2 = await actor(ctx, 'AGENT_N2');
    const empty = await ctx.app.inject({ method: 'GET', url: '/public/status' });
    expect(empty.json()).toEqual({ operational: true, active: [], recent: [] });

    const ticket = (await n2.post('/tickets', { subject: 'Panne', description: 'Tout est down.', type: 'BUG' })).json();
    const a = (await n2.post('/incidents', { title: 'Panne A', severity: 'P0', message: 'Message public.', ticketId: ticket.id })).json();
    const b = (await n2.post('/incidents', { title: 'Panne B', severity: 'P1', message: 'Autre.' })).json();
    await n2.post(`/incidents/${b.id}/updates`, { status: 'RESOLVED', message: 'Réglé.' });

    const res = await ctx.app.inject({ method: 'GET', url: '/public/status' });
    const status = res.json();
    expect(status.operational).toBe(false);
    expect(status.active.map((i: { id: string }) => i.id)).toEqual([a.id]);
    expect(status.recent.map((i: { id: string }) => i.id)).toEqual([b.id]);
    expect(status.active[0].updates[0].message).toBe('Message public.');
    expect(res.body).not.toMatch(/ticketId|authorId|createdBy|@test\.local/);
  });

  it('diffuse aux clients impactés sans créer de ticket, en le journalisant honnêtement', async () => {
    const n2 = await actor(ctx, 'AGENT_N2');
    await ctx.prisma.mailbox.create({ data: { name: 'Support', address: 'support@mango.test', webhookToken: 'w'.repeat(64) } });
    const { id } = (await n2.post('/incidents', { title: 'Panne', severity: 'P0', message: 'Début.' })).json();
    const before = await ctx.prisma.ticket.count();

    const res = await n2.post(`/incidents/${id}/broadcast`, {
      recipients: ['Claire@client.local', 'claire@client.local', 'marc@client.local'],
      subject: 'Incident en cours',
      message: 'Nous travaillons à la résolution.',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ recipients: 2, sent: 2, failed: 0 });
    expect(ctx.mail.sent.map((m) => m.to).sort()).toEqual(['claire@client.local', 'marc@client.local']);
    expect(ctx.mail.sent[0]!.text).toContain('/status');
    expect(await ctx.prisma.ticket.count()).toBe(before);
    expect((await n2.get(`/incidents/${id}`)).json().broadcasts).toHaveLength(1);

    expect((await n2.post(`/incidents/${id}/broadcast`, { recipients: ['pas-un-mail'], subject: 's', message: 'm' })).statusCode).toBe(400);
  });

  it('enregistre le post-mortem', async () => {
    const n2 = await actor(ctx, 'AGENT_N2');
    const { id } = (await n2.post('/incidents', { title: 'Panne', severity: 'P1', message: 'Début.' })).json();
    const res = await n2.put(`/incidents/${id}/postmortem`, { impact: '2 h de coupure', rootCause: 'Migration mal testée', actions: null });
    expect(res.json()).toMatchObject({ pmImpact: '2 h de coupure', pmRootCause: 'Migration mal testée', pmActions: null });
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'incident.postmortem_saved' } });
    expect(JSON.stringify(audit.changes)).not.toContain('Migration');
  });
});
