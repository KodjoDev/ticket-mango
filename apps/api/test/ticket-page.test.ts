import { actor, describeDb, resetDb, setup, teardown, type TestContext } from './helpers';

describeDb('page ticket : disposition et historique du demandeur', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  it('enregistre la disposition et la renvoie dans la configuration', async () => {
    const admin = await actor(ctx, 'ADMIN');
    const agent = await actor(ctx, 'AGENT_N1');
    const initial = (await agent.get('/config')).json().ticketPage;
    expect(initial).toHaveLength(14);

    const layout = [...initial].reverse().map((i: { key: string }) => ({ ...i, column: i.key === 'sla' ? 'main' : (initial.find((x: { key: string }) => x.key === i.key).column) }));
    expect((await admin.put('/admin/layout/ticket-page', layout)).statusCode).toBe(200);
    const saved = (await agent.get('/config')).json().ticketPage;
    expect(saved.map((i: { key: string }) => i.key)).toEqual(layout.map((i: { key: string }) => i.key));
    expect(saved.find((i: { key: string }) => i.key === 'sla').column).toBe('main');
    expect((await agent.put('/admin/layout/ticket-page', layout)).statusCode).toBe(403);
  });

  it('refuse un bloc manquant ou la conversation masquée', async () => {
    const admin = await actor(ctx, 'ADMIN');
    const layout = (await admin.get('/config')).json().ticketPage;
    expect((await admin.put('/admin/layout/ticket-page', layout.slice(1))).statusCode).toBe(400);
    const hidden = layout.map((i: { key: string }) => (i.key === 'conversation' ? { ...i, visible: false } : i));
    expect((await admin.put('/admin/layout/ticket-page', hidden)).statusCode).toBe(400);
  });

  it('liste les autres tickets du demandeur, au support seulement', async () => {
    const client = await actor(ctx, 'EXTERNAL_USER');
    const other = await actor(ctx, 'EXTERNAL_USER');
    const agent = await actor(ctx, 'AGENT_N1');
    const first = (await client.post('/tickets', { subject: 'Premier', description: 'a' })).json();
    const second = (await client.post('/tickets', { subject: 'Second', description: 'b' })).json();
    await other.post('/tickets', { subject: 'D’un autre', description: 'c' });

    const res = await agent.get(`/tickets/${second.id}/requester-history`);
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
    expect(res.json().items).toEqual([expect.objectContaining({ id: first.id, subject: 'Premier' })]);
    expect((await client.get(`/tickets/${second.id}/requester-history`)).statusCode).toBe(403);
  });
});
