import type { PrismaClient } from '@prisma/client';
import type { ViewFilters } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { ConfigService } from '../services/config';
import { TicketService, viewToFilters } from '../services/tickets';

/** Vues de la barre latérale, avec le nombre de tickets correspondant pour l'agent connecté. */
export const viewRoutes: FastifyPluginAsync<{ prisma: PrismaClient; config: ConfigService }> = async (
  app,
  { prisma, config },
) => {
  const tickets = new TicketService(prisma, config);

  app.get('/', { preHandler: [app.authenticate, app.requirePermission('ticket:read:all')] }, async (request) => {
    const views = await prisma.view.findMany({ orderBy: { position: 'asc' } });
    return Promise.all(
      views.map(async (view) => ({
        ...view,
        count: await tickets.count(request.currentUser, viewToFilters(request.currentUser, view.filters as ViewFilters)),
      })),
    );
  });
};
