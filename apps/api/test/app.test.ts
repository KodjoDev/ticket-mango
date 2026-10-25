import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';

// Tests sans base de données : ils tournent partout, y compris sans DATABASE_URL.
describe('application', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://nobody:nobody@127.0.0.1:1/none' } },
  });
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({
      prisma,
      config: { JWT_SECRET: 'x'.repeat(32), JWT_EXPIRES_IN: '1h', LOGIN_RATE_LIMIT: 10, COOKIE_SECURE: false },
    });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('exige un jeton sur les routes protégées', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets' });
    expect(res.statusCode).toBe(401);
  });

  it('rejette un jeton invalide', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: 'Bearer abc' } });
    expect(res.statusCode).toBe(401);
  });

  it('valide le corps de la connexion', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'pas-un-email' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues.map((i: { path: string }) => i.path)).toEqual(['email', 'password']);
  });

  it('signale une base indisponible par un 503', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
  });

  it('efface le cookie de session à la déconnexion', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(204);
    expect(res.cookies).toEqual([expect.objectContaining({ name: 'session', value: '' })]);
  });

  it('ajoute les en-têtes de sécurité', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
