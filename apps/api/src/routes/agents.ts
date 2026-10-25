import type { PrismaClient } from '@prisma/client';
import { ROLES, hasPermission } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';

/** Rôles auxquels un ticket peut être assigné. */
const ASSIGNABLE_ROLES = ROLES.filter((role) => hasPermission(role, 'ticket:transition'));

/** Liste des agents assignables, accessible sans être administrateur. */
export const agentRoutes: FastifyPluginAsync<{ prisma: PrismaClient }> = async (app, { prisma }) => {
  app.get('/', { preHandler: [app.authenticate, app.requirePermission('ticket:assign')] }, async () =>
    prisma.user.findMany({
      where: { isActive: true, role: { in: ASSIGNABLE_ROLES } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    }),
  );
};
