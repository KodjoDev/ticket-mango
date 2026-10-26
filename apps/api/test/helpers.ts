import { PrismaClient } from '@prisma/client';
import type { Role } from '@ticketing/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/lib/password';
import { MemoryTransport } from '../src/services/email/smtp';
import { MemoryFileStorage } from '../src/services/storage';

/** Les tests d'intégration exigent une base PostgreSQL migrée (DATABASE_URL). */
export const describeDb = describe.skipIf(!process.env.DATABASE_URL);

export const PASSWORD = 'mot-de-passe-de-test';

export interface TestContext {
  app: FastifyInstance;
  prisma: PrismaClient;
  storage: MemoryFileStorage;
  /** E-mails « envoyés » pendant le test. */
  mail: MemoryTransport;
  /** Appels sortants vers Jira / GitHub ; répondre via `respond`. */
  devCalls: { url: string; method: string; body: unknown }[];
  respond: { current: (url: string, method: string, body: unknown) => unknown };
}

export async function setup(): Promise<TestContext> {
  const prisma = new PrismaClient();
  const storage = new MemoryFileStorage();
  const mail = new MemoryTransport();
  const devCalls: TestContext['devCalls'] = [];
  const respond: TestContext['respond'] = { current: () => ({}) };
  const app = await buildApp({
    devFetch: async (url, init) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      devCalls.push({ url, method, body });
      const json = respond.current(url, method, body);
      return new Response(JSON.stringify(json), { status: json === null ? 404 : 200 });
    },
    prisma,
    storage,
    mailTransport: mail,
    config: { JWT_SECRET: 'x'.repeat(32), JWT_EXPIRES_IN: '1h', LOGIN_RATE_LIMIT: 10_000, COOKIE_SECURE: false },
  });
  await app.ready();
  return { app, prisma, storage, mail, devCalls, respond };
}

export async function teardown({ app, prisma }: TestContext) {
  await app.close();
  await prisma.$disconnect();
}

/** Valeurs de liste créées par la migration, dans leur ordre d'origine. */
const DEFAULT_OPTIONS = {
  TYPE: ['BUG', 'FEATURE_REQUEST', 'QUESTION', 'MAJOR_INCIDENT'],
  COMPONENT: ['FRONTEND', 'API', 'DATABASE', 'BILLING', 'AUTH', 'OTHER'],
  ENVIRONMENT: ['PRODUCTION', 'STAGING', 'ACCEPTANCE'],
} as const;

export const GROUP_IDS = {
  n1: '00000000-0000-4000-8000-000000000001',
  n2: '00000000-0000-4000-8000-000000000002',
  devops: '00000000-0000-4000-8000-000000000003',
  product: '00000000-0000-4000-8000-000000000004',
} as const;

const DEFAULT_GROUPS = [
  { id: GROUP_IDS.n1, name: 'Support N1', distribution: 'ROUND_ROBIN' as const },
  { id: GROUP_IDS.n2, name: 'Support N2', distribution: 'LOAD' as const },
  { id: GROUP_IDS.devops, name: 'DevOps', distribution: 'MANUAL' as const },
  { id: GROUP_IDS.product, name: 'Produit / QA', distribution: 'MANUAL' as const },
];

const DEFAULT_RULES = [
  { name: 'Incidents critiques', conditions: { priority: ['P0', 'P1'] }, groupId: GROUP_IDS.n2 },
  { name: 'Évolutions', conditions: { type: ['FEATURE_REQUEST'] }, groupId: GROUP_IDS.product },
  { name: 'Base de données', conditions: { component: ['DATABASE'] }, groupId: GROUP_IDS.devops },
  { name: 'Par défaut', conditions: {}, groupId: GROUP_IDS.n1 },
];

const SEEDED_MACROS = [
  'Invitation Meet',
  'Proposition de créneaux',
  "Demande d'informations complémentaires",
  'Correctif livré',
  'Accusé de réception (e-mail)',
];

export async function resetDb(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "IncidentBroadcast", "AlertDelivery", "AlertChannel", "IncidentUpdate", "Incident", "DevLink", "DevIntegration", "Attachment", "OutboundEmail", "InboundEmail", "Mailbox", "AuditLog", "Comment", "TicketTag", "Tag", "MeetingAttendee", "MeetingSlot", "Meeting", "Notification", "SlaAlert", "SlaPause", "GroupMember", "RoutingRule", "Group", "Ticket", "User", "Setting", "View" RESTART IDENTITY CASCADE',
  );
  // Groupes et règles de routage tels que créés par la migration.
  await prisma.group.createMany({ data: DEFAULT_GROUPS.map((g, position) => ({ ...g, position })) });
  await prisma.routingRule.createMany({ data: DEFAULT_RULES.map((r, position) => ({ ...r, position })) });
  // Macros : seules celles créées par la migration sont conservées.
  await prisma.macro.deleteMany({ where: { name: { notIn: [...SEEDED_MACROS] } } });
  await prisma.macro.updateMany({ data: { isActive: true } });
  // Les listes de qualification sont restaurées plutôt que vidées : la migration les initialise.
  for (const [field, keys] of Object.entries(DEFAULT_OPTIONS) as [keyof typeof DEFAULT_OPTIONS, readonly string[]][]) {
    await prisma.fieldOption.deleteMany({ where: { field, key: { notIn: [...keys] } } });
    for (const [position, key] of keys.entries()) {
      await prisma.fieldOption.update({ where: { field_key: { field, key } }, data: { position, isActive: true } });
    }
  }
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
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    ctx.app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
  return {
    user,
    /** En-tête d'autorisation, pour les requêtes construites à la main (multipart). */
    token: `Bearer ${token}`,
    get: (url: string) => request('GET', url),
    post: (url: string, payload?: object) => request('POST', url, payload),
    patch: (url: string, payload?: object) => request('PATCH', url, payload),
    put: (url: string, payload?: object) => request('PUT', url, payload),
    del: (url: string) => request('DELETE', url),
  };
}
