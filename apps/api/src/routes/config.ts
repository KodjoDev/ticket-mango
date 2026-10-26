import type { PrismaClient } from '@prisma/client';
import { hasPermission } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { ConfigService } from '../services/config';

/** Configuration nécessaire à l'interface, chargée une fois à l'ouverture de session. */
/** Fonctionnalités dépendant de la configuration du serveur. */
export interface Features {
  spellcheck: boolean;
  meetingProvider: string;
}

export const configRoutes: FastifyPluginAsync<{ prisma: PrismaClient; config: ConfigService; features: Features }> = async (
  app,
  { prisma, config, features },
) => {
  app.get('/', { preHandler: app.authenticate }, async (request) => {
    const [options, tags, priorityMatrix, ticketForm, listColumns, slaPolicy, groups, customFields] = await Promise.all([
      config.options(),
      prisma.tag.findMany({ orderBy: { name: 'asc' } }),
      config.priorityMatrix(),
      config.ticketForm(),
      config.listColumns(),
      config.slaPolicy(),
      prisma.group.findMany({
        orderBy: { position: 'asc' },
        select: { id: true, name: true, isActive: true, members: { select: { userId: true } } },
      }),
      config.customFields(),
    ]);
    return {
      options,
      tags,
      priorityMatrix,
      ticketForm,
      listColumns,
      slaPolicy,
      // Un demandeur ne reçoit que les champs qui lui sont ouverts.
      customFields: customFields.filter((f) => f.isActive && (hasPermission(request.currentUser.role, 'ticket:qualify') || f.forRequester)),
      groups: groups.map(({ members, ...g }) => ({ ...g, memberIds: members.map((m) => m.userId) })),
      features,
    };
  });
};
