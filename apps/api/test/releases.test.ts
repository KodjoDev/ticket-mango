import { actor, describeDb, resetDb, setup, teardown, type TestContext } from './helpers';

describeDb('release notes', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await ctx.prisma.mailbox.create({ data: { name: 'Support', address: 'support@mango.test', webhookToken: 'w'.repeat(64) } });
  });

  async function ready(type: string, subject: string, status: 'READY_FOR_RELEASE' | 'IN_PROGRESS' = 'READY_FOR_RELEASE') {
    const n2 = await actor(ctx, 'AGENT_N2');
    const t = (await n2.post('/tickets', { subject, description: 'Description.', type })).json();
    await ctx.prisma.ticket.update({ where: { id: t.id }, data: { status } });
    return t as { id: number; requester: { id: string } };
  }

  it('réserve l’écriture à release:manage et refuse une version en double', async () => {
    const n1 = await actor(ctx, 'AGENT_N1');
    const n2 = await actor(ctx, 'AGENT_N2');
    expect((await n1.post('/releases', { version: '1.0.0' })).statusCode).toBe(403);
    expect((await n1.get('/releases')).statusCode).toBe(200);
    expect((await n2.post('/releases', { version: '1.0.0' })).statusCode).toBe(201);
    expect((await n2.post('/releases', { version: '1.0.0' })).statusCode).toBe(409);
  });

  it('classe les tickets par défaut et compile les deux niveaux de lecture', async () => {
    const n2 = await actor(ctx, 'AGENT_N2');
    const { id } = (await n2.post('/releases', { version: '1.2.0' })).json();
    const feature = await ready('FEATURE_REQUEST', 'Export CSV');
    const bug = await ready('BUG', 'Erreur 500 à la connexion');
    const early = await ready('BUG', 'Pas prêt', 'IN_PROGRESS');

    expect((await n2.post(`/releases/${id}/tickets`, { ticketIds: [early.id] })).statusCode).toBe(409);
    const added = await n2.post(`/releases/${id}/tickets`, { ticketIds: [feature.id, bug.id] });
    expect(added.statusCode).toBe(200);

    await n2.patch(`/releases/${id}/tickets/${bug.id}`, { summary: 'La connexion ne plante plus.' });
    const { notes } = (await n2.get(`/releases/${id}`)).json();
    expect(notes.technical.map((s: { category: string }) => s.category)).toEqual(['NEW', 'FIX']);
    expect(notes.customer).toEqual([{ category: 'FIX', items: [{ text: 'La connexion ne plante plus.' }] }]);

    // Un ticket ne peut figurer que dans une version.
    const other = (await n2.post('/releases', { version: '1.3.0' })).json();
    expect((await n2.post(`/releases/${other.id}/tickets`, { ticketIds: [bug.id] })).statusCode).toBe(409);
    const candidates = (await n2.get(`/releases/${other.id}/candidates`)).json();
    expect(candidates).toEqual([]);
  });

  it('publie, prévient chaque demandeur une seule fois et verrouille la version', async () => {
    const n2 = await actor(ctx, 'AGENT_N2');
    const { id } = (await n2.post('/releases', { version: '2.0.0' })).json();
    const a = await ready('BUG', 'Bug A');
    const b = await ready('BUG', 'Bug B');
    await n2.post(`/releases/${id}/tickets`, { ticketIds: [a.id, b.id] });
    await n2.patch(`/releases/${id}/tickets/${a.id}`, { summary: 'Correction A.' });

    const res = await n2.post(`/releases/${id}/publish`, { notify: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().notification).toMatchObject({ requesters: 2, sent: 2, failed: 0 });
    // Chaque demandeur (ici un par ticket) reçoit son propre e-mail.
    expect(ctx.mail.sent).toHaveLength(2);
    const texts = ctx.mail.sent.map((m) => m.text).join('\n');
    expect(texts).toContain('Correction A.');
    expect(texts).toContain('Bug B');
    expect(texts).toContain('Demande #');

    expect((await n2.post(`/releases/${id}/notify`)).statusCode).toBe(409);
    expect((await n2.patch(`/releases/${id}/tickets/${a.id}`, { summary: 'x' })).statusCode).toBe(409);
    expect((await n2.del(`/releases/${id}`)).statusCode).toBe(409);
  });

  it('refuse de publier une version vide', async () => {
    const n2 = await actor(ctx, 'AGENT_N2');
    const { id } = (await n2.post('/releases', { version: '3.0.0' })).json();
    expect((await n2.post(`/releases/${id}/publish`, { notify: false })).statusCode).toBe(409);
  });

  it('expose le portail public sans numéros de ticket ni notes techniques', async () => {
    const n2 = await actor(ctx, 'AGENT_N2');
    const { id } = (await n2.post('/releases', { version: '4.0.0', title: 'Grosse version' })).json();
    const t = await ready('FEATURE_REQUEST', 'Sujet interne');
    await n2.post(`/releases/${id}/tickets`, { ticketIds: [t.id] });
    await n2.patch(`/releases/${id}/tickets/${t.id}`, { summary: 'Nouvel export.' });
    expect((await ctx.app.inject({ method: 'GET', url: '/public/releases' })).json()).toEqual([]);

    await n2.post(`/releases/${id}/publish`, { notify: false });
    const res = await ctx.app.inject({ method: 'GET', url: '/public/releases' });
    expect(res.json()).toEqual([
      expect.objectContaining({ version: '4.0.0', title: 'Grosse version', sections: [{ category: 'NEW', items: [{ text: 'Nouvel export.' }] }] }),
    ]);
    expect(res.body).not.toMatch(/Sujet interne|ticketId/);
  });
});
