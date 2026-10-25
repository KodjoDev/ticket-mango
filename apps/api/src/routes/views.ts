import type { PrismaClient } from '@prisma/client';
import type { ViewFilters } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { viewToFilters, type TicketService } from '../services/tickets';

/** Vues de la barre latérale, avec le nombre de tickets correspondant pour l'agent connecté. */
export const viewRoutes: FastifyPluginAsync<{ prisma: PrismaClient; tickets: TicketService }> = async (
  app,
  { prisma, tickets },
) => {
  app.get('/', { preHandler: [app.authenticate, app.requirePermission('ticket:read:all')] }, async (request) => {
    const user = request.currentUser;
    const [views, groupIds] = await Promise.all([
      prisma.view.findMany({ orderBy: { position: 'asc' } }),
      tickets.userGroupIds(user.id),
    ]);
    return Promise.all(
      views.map(async (view) => ({
        ...view,
        count: await tickets.count(user, viewToFilters(user, view.filters as ViewFilters, groupIds)),
      })),
    );
  });
};
