import { actor, describeDb, resetDb, setup, teardown, type TestContext } from './helpers';

describeDb('macros', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(() => resetDb(ctx.prisma));

  const base = { subject: 'Facture en double', description: 'Deux prélèvements.' };

  it('liste les macros actives pour le support uniquement', async () => {
    const agent = await actor(ctx, 'AGENT_N1');
    const client = await actor(ctx, 'EXTERNAL_USER');
    const names = (await agent.get('/macros')).json().map((m: { name: string }) => m.name);
    expect(names).toEqual(['Invitation Meet', 'Proposition de créneaux', "Demande d'informations complémentaires", 'Correctif livré']);
    expect((await client.get('/macros')).statusCode).toBe(403);
  });

  it('publie le message puis applique statut, tags et assignation', async () => {
    const admin = await actor(ctx, 'ADMIN');
    const agent = await actor(ctx, 'AGENT_N1');
    const tag = (await admin.post('/admin/tags', { name: 'Facturation', color: '#ad5918' })).json();
    const macro = (
      await admin.post('/admin/macros', {
        name: 'Prise en charge facturation',
        body: 'Bonjour {{demandeur.prenom}}, nous regardons.',
        isInternal: false,
        actions: { status: 'QUALIFYING', addTagIds: [tag.id], assignToMe: true },
      })
    ).json();
    const { id } = (await agent.post('/tickets', base)).json();

    const res = await agent.post(`/macros/${macro.id}/apply`, { ticketId: id, body: 'Bonjour Alice, nous regardons.' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket).toMatchObject({ status: 'QUALIFYING', assignee: { id: agent.user.id } });
    expect(res.json().ticket.tags.map((t: { name: string }) => t.name)).toEqual(['Facturation']);
    expect(res.json().comment).toMatchObject({ body: 'Bonjour Alice, nous regardons.', isInternal: false });
    expect((await agent.get(`/tickets/${id}`)).json().firstResponseAt).not.toBeNull();
  });

  it('n’écrit rien si une action est impossible', async () => {
    const admin = await actor(ctx, 'ADMIN');
    const macro = (
      await admin.post('/admin/macros', { name: 'Recette', body: 'En recette.', isInternal: true, actions: { status: 'IN_QA' } })
    ).json();
    const { id } = (await admin.post('/tickets', base)).json();
    expect((await admin.post(`/macros/${macro.id}/apply`, { ticketId: id, body: 'En recette.' })).statusCode).toBe(409);
    expect((await admin.get(`/tickets/${id}/comments`)).json()).toEqual([]);
  });

  it('refuse une variable inconnue et protège les macros système', async () => {
    const admin = await actor(ctx, 'ADMIN');
    const bad = await admin.post('/admin/macros', { name: 'X', body: 'Bonjour {{demandeur.age}}', isInternal: false, actions: {} });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toContain('{{demandeur.age}}');

    const system = (await admin.get('/admin/macros')).json().find((m: { systemKey: string }) => m.systemKey === 'meeting_scheduled');
    expect((await admin.del(`/admin/macros/${system.id}`)).statusCode).toBe(400);
    expect((await admin.patch(`/admin/macros/${system.id}`, { isActive: false })).statusCode).toBe(400);
    expect((await admin.patch(`/admin/macros/${system.id}`, { name: 'Invitation visio' })).json().name).toBe('Invitation visio');
    await ctx.prisma.macro.update({ where: { id: system.id }, data: { name: 'Invitation Meet' } });
  });

  it('cantonne le développeur aux notes internes', async () => {
    const agent = await actor(ctx, 'AGENT_N1');
    const dev = await actor(ctx, 'DEVELOPER');
    const { id } = (await agent.post('/tickets', base)).json();
    expect((await dev.post(`/tickets/${id}/comments`, { body: 'Reproduit en local', isInternal: true })).statusCode).toBe(201);
    expect((await dev.post(`/tickets/${id}/comments`, { body: 'Bonjour', isInternal: false })).statusCode).toBe(403);
    expect((await dev.patch(`/tickets/${id}`, { urgency: 'HIGH' })).statusCode).toBe(403);
  });
});
