import type { PrismaClient } from '@prisma/client';
import { ALERT_KINDS, INCIDENT_SEVERITIES, INCIDENT_STATUSES, type AlertKindName } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SecretBox } from '../lib/secrets';
import type { IncidentService } from '../services/incidents/service';

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = z.string().trim().max(10_000).nullable();

/** Gestion des incidents (préfixe /incidents) : lecture pour le support, écriture avec incident:manage. */
export const incidentRoutes: FastifyPluginAsync<{ incidents: IncidentService }> = async (app, { incidents }) => {
  app.addHook('preHandler', app.authenticate);
  const manage = { preHandler: app.requirePermission('incident:manage') };
  const read = { preHandler: app.requirePermission('ticket:read:all') };

  app.get('/', read, async (request) => {
    const { active } = z.object({ active: z.enum(['true', 'false']).optional() }).parse(request.query);
    return incidents.list(active === 'true');
  });

  app.get('/:id', read, async (request) => incidents.get(idParams.parse(request.params).id));

  app.post('/', manage, async (request, reply) => {
    const input = z
      .object({
        title: text(200),
        severity: z.enum(INCIDENT_SEVERITIES),
        message: text(2000),
        ticketId: z.number().int().positive().nullish(),
      })
      .strict()
      .parse(request.body);
    return reply.status(201).send(await incidents.open(request.currentUser, input));
  });

  app.post('/:id/updates', manage, async (request) => {
    const input = z.object({ status: z.enum(INCIDENT_STATUSES), message: text(2000) }).strict().parse(request.body);
    return incidents.postUpdate(request.currentUser, idParams.parse(request.params).id, input);
  });

  app.put('/:id/postmortem', manage, async (request) => {
    const input = z.object({ impact: optionalText, rootCause: optionalText, actions: optionalText }).strict().parse(request.body);
    return incidents.savePostMortem(request.currentUser, idParams.parse(request.params).id, input);
  });

  app.post('/:id/broadcast', manage, async (request) => {
    const input = z
      .object({
        recipients: z.array(z.string().trim().toLowerCase().email().max(254)).min(1).max(500),
        subject: text(200),
        message: text(5000),
      })
      .strict()
      .parse(request.body);
    return incidents.broadcast(request.currentUser, idParams.parse(request.params).id, input);
  });
};

/** Status page publique, sans connexion (préfixe /public/status). */
export const publicStatusRoutes: FastifyPluginAsync<{ incidents: IncidentService }> = async (app, { incidents }) => {
  app.get('/', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=30');
    return incidents.publicStatus();
  });
};

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => u.startsWith('https://'), 'Adresse https:// attendue');

const channelSchema = z.object({
  kind: z.enum(ALERT_KINDS),
  name: text(100),
  isActive: z.boolean(),
  /** Écriture seule : jamais renvoyé. URL https (Slack, Teams, webhook) ou clé d'intégration (PagerDuty). */
  target: z.string().trim().min(1).max(500),
});

type ChannelRow = Awaited<ReturnType<PrismaClient['alertChannel']['findFirstOrThrow']>>;
const channelDto = ({ targetEnc: _t, ...rest }: ChannelRow) => ({ ...rest, hasTarget: true });

function checkTarget(kind: AlertKindName, target: string) {
  if (kind !== 'PAGERDUTY') httpsUrl.parse(target);
}

/** Destinations d'alerte (préfixe /admin). */
export const alertAdminRoutes: FastifyPluginAsync<{ prisma: PrismaClient; secrets: SecretBox }> = async (app, { prisma, secrets }) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('settings:manage'));

  const audit = (actorId: string, action: string, c: ChannelRow) =>
    prisma.auditLog.create({ data: { actorId, action, changes: { channelId: c.id, kind: c.kind, name: c.name } } });

  app.get('/alert-channels', async () => (await prisma.alertChannel.findMany({ orderBy: { createdAt: 'asc' } })).map(channelDto));

  app.post('/alert-channels', async (request, reply) => {
    const { target, ...data } = channelSchema.partial({ isActive: true }).strict().parse(request.body);
    checkTarget(data.kind, target);
    const channel = await prisma.alertChannel.create({ data: { ...data, targetEnc: secrets.encrypt(target) } });
    await audit(request.currentUser.id, 'admin.alert_channel.created', channel);
    return reply.status(201).send(channelDto(channel));
  });

  app.patch('/alert-channels/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const { target, kind: _kind, ...data } = channelSchema.partial().strict().parse(request.body);
    if (target) {
      const current = await prisma.alertChannel.findUniqueOrThrow({ where: { id } });
      checkTarget(current.kind, target);
    }
    const channel = await prisma.alertChannel.update({ where: { id }, data: { ...data, ...(target && { targetEnc: secrets.encrypt(target) }) } });
    await audit(request.currentUser.id, 'admin.alert_channel.updated', channel);
    return channelDto(channel);
  });

  app.delete('/alert-channels/:id', async (request, reply) => {
    const channel = await prisma.alertChannel.delete({ where: { id: idParams.parse(request.params).id } });
    await audit(request.currentUser.id, 'admin.alert_channel.deleted', channel);
    return reply.status(204).send();
  });
};
