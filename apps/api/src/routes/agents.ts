import type { PrismaClient } from '@prisma/client';
import { ROLES, hasPermission } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

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

const requesterSelect = { id: true, name: true, email: true, role: true } as const;
const searchSchema = z.object({ q: z.string().trim().max(200).default('') });
const contactSchema = z
  .object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(1).max(200) })
  .strict();

/** Demandeurs possibles d'un ticket saisi par le support : recherche et création de contact. */
export const requesterRoutes: FastifyPluginAsync<{ prisma: PrismaClient }> = async (app, { prisma }) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('ticket:qualify'));

  app.get('/', async (request) => {
    const { q } = searchSchema.parse(request.query);
    return prisma.user.findMany({
      where: {
        isActive: true,
        ...(q && {
          OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }],
        }),
      },
      select: requesterSelect,
      orderBy: { name: 'asc' },
      take: 20,
    });
  });

  // Contact sans mot de passe, comme ceux créés à la réception d'un e-mail ; une adresse connue est réutilisée.
  app.post('/', async (request, reply) => {
    const data = contactSchema.parse(request.body);
    const existing = await prisma.user.findUnique({
      where: { email: data.email },
      select: { ...requesterSelect, isActive: true },
    });
    if (existing) {
      if (!existing.isActive) return reply.conflict('Cette adresse appartient à un compte désactivé');
      const { isActive: _isActive, ...user } = existing;
      return user;
    }
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { ...data, role: 'EXTERNAL_USER', passwordHash: null },
        select: requesterSelect,
      });
      await tx.auditLog.create({
        data: {
          actorId: request.currentUser.id,
          action: 'user.created',
          changes: { userId: created.id, email: data.email, name: data.name, role: 'EXTERNAL_USER' },
        },
      });
      return created;
    });
    return reply.status(201).send(user);
  });
};
