import type { PrismaClient } from '@prisma/client';
import { DEFAULT_STATUS_MAPS, DEV_PROVIDERS, DEV_SYNC_STATUSES } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SecretBox } from '../lib/secrets';
import { newWebhookToken } from '../services/email/inbound';
import { githubIssue, jiraIssue } from '../services/dev/providers';
import { readStatusMap, type DevService } from '../services/dev/service';

const uuid = z.string().uuid();
const httpsUrl = z
  .string()
  .trim()
  .max(255)
  .url()
  .refine((u) => u.startsWith('https://'), 'Adresse https:// attendue');

const integrationSchema = z
  .object({
    provider: z.enum(DEV_PROVIDERS),
    name: z.string().trim().min(1).max(100),
    isActive: z.boolean(),
    baseUrl: httpsUrl.nullable(),
    account: z.string().trim().max(255).nullable(),
    /** Écriture seule : jamais renvoyé. Chaîne vide = inchangé. */
    token: z.string().max(500),
    project: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^([A-Za-z][A-Za-z0-9_]+|[\w.-]+\/[\w.-]+)$/, 'Clé de projet Jira (APP) ou dépôt GitHub (propriétaire/nom) attendu'),
    issueType: z.string().trim().min(1).max(100),
    statusMap: z.record(z.string().trim().min(1).max(100), z.enum(DEV_SYNC_STATUSES)),
  })
  .partial()
  .strict();

type IntegrationRow = Awaited<ReturnType<PrismaClient['devIntegration']['findFirstOrThrow']>>;

/** Intégration telle que renvoyée à l'interface : sans jeton, avec l'URL du webhook. */
function integrationDto({ tokenEnc, webhookToken, ...rest }: IntegrationRow, publicApiUrl: string) {
  return {
    ...rest,
    statusMap: readStatusMap(rest.statusMap),
    hasToken: !!tokenEnc,
    webhookUrl: `${publicApiUrl.replace(/\/$/, '')}/inbound/dev/${webhookToken}`,
  };
}

/** Administration des intégrations (préfixe /admin). */
export const devAdminRoutes: FastifyPluginAsync<{ prisma: PrismaClient; secrets: SecretBox; publicApiUrl: string }> = async (
  app,
  { prisma, secrets, publicApiUrl },
) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('settings:manage'));

  const audit = (actorId: string, action: string, integration: IntegrationRow) =>
    prisma.auditLog.create({
      data: { actorId, action, changes: { integrationId: integration.id, provider: integration.provider, name: integration.name } },
    });

  app.get('/dev-integrations', async () =>
    (await prisma.devIntegration.findMany({ orderBy: { createdAt: 'asc' } })).map((i) => integrationDto(i, publicApiUrl)),
  );

  app.post('/dev-integrations', async (request, reply) => {
    const { token, ...data } = integrationSchema.required({ provider: true, name: true, project: true }).parse(request.body);
    const integration = await prisma.devIntegration.create({
      data: {
        ...data,
        statusMap: data.statusMap ?? DEFAULT_STATUS_MAPS[data.provider],
        issueType: data.issueType ?? 'Bug',
        webhookToken: newWebhookToken(),
        ...(token && { tokenEnc: secrets.encrypt(token) }),
      },
    });
    await audit(request.currentUser.id, 'admin.dev_integration.created', integration);
    return reply.status(201).send(integrationDto(integration, publicApiUrl));
  });

  app.patch('/dev-integrations/:id', async (request) => {
    const { id } = z.object({ id: uuid }).parse(request.params);
    const { token, provider: _provider, ...data } = integrationSchema.parse(request.body);
    const integration = await prisma.devIntegration.update({
      where: { id },
      data: { ...data, ...(token && { tokenEnc: secrets.encrypt(token) }) },
    });
    await audit(request.currentUser.id, 'admin.dev_integration.updated', integration);
    return integrationDto(integration, publicApiUrl);
  });

  // Les liens existants disparaissent avec l'intégration (cascade) ; on préfère la désactiver si elle sert encore.
  app.delete('/dev-integrations/:id', async (request, reply) => {
    const { id } = z.object({ id: uuid }).parse(request.params);
    const integration = await prisma.devIntegration.delete({ where: { id } });
    await audit(request.currentUser.id, 'admin.dev_integration.deleted', integration);
    return reply.status(204).send();
  });
};

/** Liaison des tickets aux issues (préfixe /dev), réservée au support. */
export const devRoutes: FastifyPluginAsync<{ dev: DevService }> = async (app, { dev }) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/integrations', { preHandler: app.requirePermission('ticket:qualify') }, async () => dev.listActive());

  app.post('/tickets/:id/links', async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const { integrationId, reference } = z
      .object({ integrationId: uuid, reference: z.string().trim().min(1).max(500).optional() })
      .strict()
      .parse(request.body);
    return reply.status(201).send(await dev.link(request.currentUser, id, integrationId, reference));
  });

  app.delete('/tickets/:id/links/:linkId', async (request, reply) => {
    const { id, linkId } = z.object({ id: z.coerce.number().int().positive(), linkId: uuid }).parse(request.params);
    await dev.unlink(request.currentUser, id, linkId);
    return reply.status(204).send();
  });
};

/**
 * Webhooks entrants (préfixe /inbound) : l'URL contient le jeton secret de l'intégration.
 * Jira : webhook « issue created / updated ». GitHub : événement « Issues », contenu JSON.
 */
export const devWebhookRoutes: FastifyPluginAsync<{ prisma: PrismaClient; dev: DevService }> = async (app, { prisma, dev }) => {
  app.post(
    '/dev/:token',
    { bodyLimit: 1_000_000, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { token } = z.object({ token: z.string().min(32).max(128) }).parse(request.params);
      const integration = await prisma.devIntegration.findUnique({ where: { webhookToken: token } });
      if (!integration || !integration.isActive) return reply.notFound('Intégration inconnue');

      // 200 pour tout événement sans intérêt : l'outil ne doit pas le renvoyer en boucle.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- charge utile externe, lue champ par champ
      const body = (request.body ?? {}) as { issue?: any; repository?: { full_name?: string } };
      let issue = null;
      if (integration.provider === 'JIRA' && body.issue?.key && body.issue.fields) {
        issue = jiraIssue(integration.baseUrl ?? '', body.issue);
      } else if (integration.provider === 'GITHUB' && body.issue?.number && request.headers['x-github-event'] === 'issues') {
        const repo = String(body.repository?.full_name ?? '');
        if (repo.toLowerCase() === integration.project.toLowerCase()) {
          issue = githubIssue(integration.project, body.issue, readStatusMap(integration.statusMap));
        }
      }
      if (!issue) return { status: 'ignored', tickets: 0 };
      return { status: 'ok', tickets: await dev.applyEvent(integration, issue) };
    },
  );
};

