import type { PrismaClient } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import type { ConfigService } from '../services/config';

/** Configuration nécessaire à l'interface, chargée une fois à l'ouverture de session. */
export const configRoutes: FastifyPluginAsync<{ prisma: PrismaClient; config: ConfigService }> = async (
  app,
  { prisma, config },
) => {
  app.get('/', { preHandler: app.authenticate }, async () => {
    const [options, tags, priorityMatrix, ticketForm, listColumns] = await Promise.all([
      config.options(),
      prisma.tag.findMany({ orderBy: { name: 'asc' } }),
      config.priorityMatrix(),
      config.ticketForm(),
      config.listColumns(),
    ]);
    return { options, tags, priorityMatrix, ticketForm, listColumns };
  });
};
