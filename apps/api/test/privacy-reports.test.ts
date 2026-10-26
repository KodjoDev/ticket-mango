import { actor, createUser, describeDb, resetDb, setup, teardown, type TestContext } from './helpers';

describeDb('reporting et RGPD', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  const range = () => {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    return `from=${day(new Date(Date.now() - 86_400_000))}&to=${day(new Date())}`;
  };

  it('agrège les tickets de la période et réserve l’accès à report:read', async () => {
    const n2 = await actor(ctx, 'AGENT_N2');
    const n1 = await actor(ctx, 'AGENT_N1');
    await n2.post('/tickets', { subject: 'Bug auth', description: 'x', type: 'BUG', component: 'AUTH' });
    await n2.post('/tickets', { subject: 'Question', description: 'x', type: 'QUESTION' });
    await ctx.prisma.ticket.updateMany({ where: { subject: 'Bug auth' }, data: { slaState: 'BREACHED' } });

    expect((await n1.get(`/reports?${range()}`)).statusCode).toBe(403);
    const res = await n2.get(`/reports?${range()}`);
    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report.total).toBe(2);
    expect(report.byChannel).toEqual([{ key: 'WEB', count: 2 }]);
    expect(report.topBugComponents).toEqual([{ key: 'AUTH', count: 1 }]);
    expect(report.slaCompliance).toBe(0.5);

    expect((await n2.get('/reports?from=2026-01-01&to=2025-01-01')).statusCode).toBe(400);
    expect((await n2.get('/reports?from=2020-01-01&to=2026-01-01')).statusCode).toBe(400);
  });

  async function externalWithData() {
    const admin = await actor(ctx, 'ADMIN');
    const client = await createUser(ctx.prisma, 'EXTERNAL_USER', { email: 'claire@client.local' });
    const ticket = await ctx.prisma.ticket.create({
      data: { subject: 'Problème', description: 'Mon IBAN est FR76...', type: 'BUG', priority: 'P3', requesterId: client.id, status: 'CLOSED', closedAt: new Date(Date.now() - 400 * 86_400_000) },
    });
    await ctx.prisma.comment.create({ data: { ticketId: ticket.id, authorId: client.id, body: 'Mon numéro : 0601020304' } });
    await ctx.prisma.inboundEmail.create({
      data: { messageId: '<m1@x>', fromAddress: 'claire@client.local', subject: 'Secret', status: 'PROCESSED', size: 10, rawKey: 'raw/m1' },
    });
    await ctx.storage.put('raw/m1', Buffer.from('brut'));
    return { admin, client, ticket };
  }

  it('exporte les données d’une personne', async () => {
    const { admin, client } = await externalWithData();
    const res = await admin.get(`/admin/privacy/users/${client.id}/export`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      user: { email: 'claire@client.local' },
      tickets: [{ subject: 'Problème' }],
      comments: [{ body: 'Mon numéro : 0601020304' }],
      receivedEmails: [{ subject: 'Secret' }],
    });
    const n2 = await actor(ctx, 'AGENT_N2');
    expect((await n2.get(`/admin/privacy/users/${client.id}/export`)).statusCode).toBe(403);
  });

  it('anonymise : identité effacée, connexion impossible, contenu effacé sur demande', async () => {
    const { admin, client, ticket } = await externalWithData();
    expect((await admin.post(`/admin/privacy/users/${admin.user.id}/anonymize`, { eraseContent: false })).statusCode).toBe(400);

    expect((await admin.post(`/admin/privacy/users/${client.id}/anonymize`, { eraseContent: true })).statusCode).toBe(204);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: client.id } });
    expect(user).toMatchObject({ name: 'Utilisateur anonymisé', isActive: false, passwordHash: null });
    expect(user.email).toMatch(/@anonymise\.invalid$/);
    expect((await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).description).toBe('[contenu supprimé]');
    expect((await ctx.prisma.comment.findFirstOrThrow({ where: { ticketId: ticket.id } })).body).toBe('[contenu supprimé]');
    const mail = await ctx.prisma.inboundEmail.findFirstOrThrow();
    expect(mail).toMatchObject({ subject: '[contenu supprimé]', rawKey: null });
    expect(mail.fromAddress).toBe(user.email);
    await expect(ctx.storage.get('raw/m1')).rejects.toThrow();

    const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'privacy.user_anonymized' } });
    expect(JSON.stringify(audit.changes)).not.toContain('claire');
    expect((await admin.post(`/admin/privacy/users/${client.id}/anonymize`, { eraseContent: false })).statusCode).toBe(409);
  });

  it('purge : simulation sans effet, puis anonymisation des seuls clients inactifs', async () => {
    const { admin, client } = await externalWithData();
    await ctx.prisma.user.update({ where: { id: client.id }, data: { createdAt: new Date(Date.now() - 500 * 86_400_000) } });
    const recent = await createUser(ctx.prisma, 'EXTERNAL_USER', { email: 'marc@client.local' });
    await ctx.prisma.ticket.create({ data: { subject: 'Ouvert', description: 'x', type: 'BUG', priority: 'P3', requesterId: recent.id } });

    expect((await admin.post('/admin/privacy/purge', { months: 3, dryRun: true })).statusCode).toBe(400);
    const dry = await admin.post('/admin/privacy/purge', { months: 12, dryRun: true });
    expect(dry.json()).toMatchObject({ dryRun: true, users: 1 });
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: client.id } })).email).toBe('claire@client.local');

    const real = await admin.post('/admin/privacy/purge', { months: 12, dryRun: false });
    expect(real.json()).toMatchObject({ dryRun: false, users: 1 });
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: client.id } })).email).toMatch(/@anonymise\.invalid$/);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: recent.id } })).email).toBe('marc@client.local');
  });
});
