import { PrismaClient } from '@prisma/client';
import type { Role } from '@ticketing/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/lib/password';

/** Les tests d'intégration exigent une base PostgreSQL migrée (DATABASE_URL). */
export const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

export const PASSWORD = 'mot-de-passe-de-test';

export interface TestContext {
  app: FastifyInstance;
  prisma: PrismaClient;
}

export async function setup(): Promise<TestContext> {
  const prisma = new PrismaClient();
  const app = await buildApp({
    prisma,
    config: { JWT_SECRET: 'x'.repeat(32), JWT_EXPIRES_IN: '1h', LOGIN_RATE_LIMIT: 10_000 },
  });
  await app.ready();
  return { app, prisma };
}

export async function teardown({ app, prisma }: TestContext) {
  await app.close();
  await prisma.$disconnect();
}

export async function resetDb(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditLog", "Comment", "Ticket", "User" RESTART IDENTITY CASCADE',
  );
}

let passwordHash: Promise<string> | undefined;

export async function createUser(prisma: PrismaClient, role: Role, overrides: { email?: string; isActive?: boolean } = {}) {
  passwordHash ??= hashPassword(PASSWORD);
  const email = overrides.email ?? `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  return prisma.user.create({
    data: { email, name: role, role, passwordHash: await passwordHash, isActive: overrides.isActive ?? true },
  });
}

export async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
  if (res.statusCode !== 200) throw new Error(`Connexion échouée (${res.statusCode}) : ${res.body}`);
  return res.json<{ token: string }>().token;
}

/** Crée un utilisateur et renvoie un client HTTP authentifié à son nom. */
export async function actor(ctx: TestContext, role: Role) {
  const user = await createUser(ctx.prisma, role);
  const token = await login(ctx.app, user.email);
  const request = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
  return {
    user,
    get: (url: string) => request('GET', url),
    post: (url: string, payload?: object) => request('POST', url, payload),
    patch: (url: string, payload?: object) => request('PATCH', url, payload),
  };
}
