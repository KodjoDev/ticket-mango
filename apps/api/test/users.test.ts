import { actor, describeDb, resetDb, setup, teardown, type TestContext } from './helpers';

describeDb('gestion des utilisateurs', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(() => resetDb(ctx.prisma));

  const newUser = { email: 'Nouveau@Test.local', name: 'Nouveau', password: 'un-mot-de-passe-long', role: 'AGENT_N1' };

  it('permet à un administrateur de créer un utilisateur', async () => {
    const admin = await actor(ctx, 'ADMIN');
    const res = await admin.post('/users', newUser);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: 'nouveau@test.local', role: 'AGENT_N1', isActive: true });
    expect(res.json()).not.toHaveProperty('passwordHash');
  });

  it('refuse un email déjà utilisé', async () => {
    const admin = await actor(ctx, 'ADMIN');
    await admin.post('/users', newUser);
    expect((await admin.post('/users', newUser)).statusCode).toBe(409);
  });

  it('refuse un mot de passe trop court', async () => {
    const admin = await actor(ctx, 'ADMIN');
    expect((await admin.post('/users', { ...newUser, password: 'court' })).statusCode).toBe(400);
  });

  it('réserve la gestion des utilisateurs aux administrateurs', async () => {
    const agent = await actor(ctx, 'AGENT_N2');
    expect((await agent.post('/users', newUser)).statusCode).toBe(403);
    expect((await agent.get('/users')).statusCode).toBe(403);
  });

  it('liste les agents assignables actifs sans exiger le rôle administrateur', async () => {
    const agent = await actor(ctx, 'AGENT_N1');
    await actor(ctx, 'EXTERNAL_USER');
    await actor(ctx, 'READER');
    const res = await agent.get('/agents');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: agent.user.id, name: 'AGENT_N1', role: 'AGENT_N1' }]);
  });

  it('refuse la liste des agents à un utilisateur externe', async () => {
    const client = await actor(ctx, 'EXTERNAL_USER');
    expect((await client.get('/agents')).statusCode).toBe(403);
  });

  it('empêche un administrateur de se désactiver lui-même', async () => {
    const admin = await actor(ctx, 'ADMIN');
    expect((await admin.patch(`/users/${admin.user.id}`, { isActive: false })).statusCode).toBe(400);
  });
});
