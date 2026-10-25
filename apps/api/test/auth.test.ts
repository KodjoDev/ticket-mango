import { actor, createUser, describeDb, PASSWORD, resetDb, setup, teardown, type TestContext } from './helpers';

describeDb('authentification', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(() => resetDb(ctx.prisma));

  const loginAs = (email: string, password: string) =>
    ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });

  it('connecte un utilisateur et renvoie un jeton sans le hash du mot de passe', async () => {
    const user = await createUser(ctx.prisma, 'AGENT_N1', { email: 'agent@test.local' });
    const res = await loginAs('AGENT@test.local', PASSWORD);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.user).toEqual({ id: user.id, email: user.email, name: user.name, role: 'AGENT_N1' });
  });

  it('rejette un mauvais mot de passe ou un compte inconnu avec le même message', async () => {
    await createUser(ctx.prisma, 'AGENT_N1', { email: 'agent@test.local' });
    const wrong = await loginAs('agent@test.local', 'mauvais');
    const unknown = await loginAs('inconnu@test.local', PASSWORD);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().message).toBe(unknown.json().message);
  });

  it('rejette un compte désactivé', async () => {
    await createUser(ctx.prisma, 'AGENT_N1', { email: 'off@test.local', isActive: false });
    expect((await loginAs('off@test.local', PASSWORD)).statusCode).toBe(401);
  });

  it('invalide immédiatement le jeton d’un compte désactivé', async () => {
    const agent = await actor(ctx, 'AGENT_N1');
    expect((await agent.get('/auth/me')).statusCode).toBe(200);
    await ctx.prisma.user.update({ where: { id: agent.user.id }, data: { isActive: false } });
    expect((await agent.get('/auth/me')).statusCode).toBe(401);
  });

  it('exige un jeton', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/tickets' })).statusCode).toBe(401);
  });
});
