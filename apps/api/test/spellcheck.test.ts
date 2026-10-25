import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import type { LanguageToolClient } from '../src/services/spellcheck';
import { createUser, describeDb, login, resetDb } from './helpers';

describeDb('correcteur', () => {
  const prisma = new PrismaClient();
  const config = { JWT_SECRET: 'x'.repeat(32), JWT_EXPIRES_IN: '1h', LOGIN_RATE_LIMIT: 10_000, COOKIE_SECURE: false };
  const check = vi.fn(async () => [
    { offset: 0, length: 4, message: 'Faute', category: 'TYPOS', ruleId: 'R', replacements: ['Bonjour'] },
  ]);

  afterAll(() => prisma.$disconnect());
  beforeEach(() => resetDb(prisma));

  async function as(app: Awaited<ReturnType<typeof buildApp>>, role: 'AGENT_N1' | 'READER') {
    const user = await createUser(prisma, role);
    return { authorization: `Bearer ${await login(app, user.email)}` };
  }

  it('relaie le texte au correcteur et annonce la fonctionnalité', async () => {
    const app = await buildApp({ prisma, config, spellchecker: { check } as unknown as LanguageToolClient });
    const headers = await as(app, 'AGENT_N1');
    const res = await app.inject({ method: 'POST', url: '/spellcheck', headers, payload: { text: 'Bonjur' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().issues[0].replacements).toEqual(['Bonjour']);
    expect(check).toHaveBeenCalledWith('Bonjur');
    expect((await app.inject({ method: 'GET', url: '/config', headers })).json().features.spellcheck).toBe(true);
    await app.close();
  });

  it('répond 503 sans correcteur configuré et refuse un rôle sans droit d’écriture', async () => {
    const app = await buildApp({ prisma, config, spellchecker: null });
    const agent = await as(app, 'AGENT_N1');
    expect((await app.inject({ method: 'POST', url: '/spellcheck', headers: agent, payload: { text: 'x' } })).statusCode).toBe(503);
    expect((await app.inject({ method: 'GET', url: '/config', headers: agent })).json().features.spellcheck).toBe(false);
    const reader = await as(app, 'READER');
    expect((await app.inject({ method: 'POST', url: '/spellcheck', headers: reader, payload: { text: 'x' } })).statusCode).toBe(403);
    await app.close();
  });
});
