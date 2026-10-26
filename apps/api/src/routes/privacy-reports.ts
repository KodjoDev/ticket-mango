import type { PrismaClient } from '@prisma/client';
import { buildReport } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { PrivacyService } from '../services/privacy';

const idParams = z.object({ id: z.string().uuid() });
const MAX_RANGE_DAYS = 366;

/** Statistiques de la période (préfixe /reports). */
export const reportRoutes: FastifyPluginAsync<{ prisma: PrismaClient }> = async (app, { prisma }) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('report:read'));

  app.get('/', async (request, reply) => {
    const { from, to } = z
      .object({ from: z.coerce.date(), to: z.coerce.date() })
      .refine((r) => r.to >= r.from, 'La fin précède le début')
      .refine((r) => r.to.getTime() - r.from.getTime() <= MAX_RANGE_DAYS * 86_400_000, `Période limitée à ${MAX_RANGE_DAYS} jours`)
      .parse(request.query);
    // Les créations de la période, fin de journée incluse.
    const end = new Date(to.getTime() + 86_400_000);
    const tickets = await prisma.ticket.findMany({
      where: { createdAt: { gte: from, lt: end } },
      select: { channel: true, type: true, priority: true, component: true, slaState: true, createdAt: true, firstResponseAt: true, resolvedAt: true },
    });
    reply.header('cache-control', 'no-store');
    return buildReport(tickets);
  });
};

/** Conformité RGPD (préfixe /admin/privacy) : export, anonymisation, purge. */
export const privacyRoutes: FastifyPluginAsync<{ privacy: PrivacyService }> = async (app, { privacy }) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('user:manage'));

  app.get('/users/:id/export', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    return privacy.export(idParams.parse(request.params).id);
  });

  app.post('/users/:id/anonymize', async (request, reply) => {
    const { eraseContent } = z.object({ eraseContent: z.boolean() }).strict().parse(request.body);
    await privacy.anonymize(request.currentUser, idParams.parse(request.params).id, eraseContent);
    return reply.status(204).send();
  });

  app.post('/purge', async (request) => {
    const { months, dryRun } = z.object({ months: z.number().int().min(1).max(120), dryRun: z.boolean() }).strict().parse(request.body);
    return privacy.purge(request.currentUser, months, dryRun);
  });
};
