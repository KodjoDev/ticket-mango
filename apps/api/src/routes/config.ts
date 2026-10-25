import type { PrismaClient } from '@prisma/client';
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
  app.get('/', { preHandler: app.authenticate }, async () => {
    const [options, tags, priorityMatrix, ticketForm, listColumns, slaPolicy, groups] = await Promise.all([
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
    ]);
    return {
      options,
      tags,
      priorityMatrix,
      ticketForm,
      listColumns,
      slaPolicy,
      groups: groups.map(({ members, ...g }) => ({ ...g, memberIds: members.map((m) => m.userId) })),
      features,
    };
  });
};
