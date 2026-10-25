import type { PrismaClient } from '@prisma/client';
import { ROLES } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '../lib/password';

export const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(12).max(256),
  role: z.enum(ROLES),
});

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    role: z.enum(ROLES),
    isActive: z.boolean(),
    password: z.string().min(12).max(256),
  })
  .partial();

const idParams = z.object({ id: z.string().uuid() });

export const userRoutes: FastifyPluginAsync<{ prisma: PrismaClient }> = async (app, { prisma }) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('user:manage'));

  app.get('/', async () => prisma.user.findMany({ select: userSelect, orderBy: { createdAt: 'asc' } }));

  app.post('/', async (request, reply) => {
    const { password, ...data } = createUserSchema.parse(request.body);
    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { ...data, passwordHash }, select: userSelect });
      await tx.auditLog.create({
        data: { actorId: request.currentUser.id, action: 'user.created', changes: { userId: created.id, ...data } },
      });
      return created;
    });
    return reply.status(201).send(user);
  });

  app.patch('/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { password, ...data } = updateUserSchema.parse(request.body);
    // Évite qu'un administrateur se retire lui-même l'accès par erreur.
    if (id === request.currentUser.id && (data.isActive === false || (data.role && data.role !== 'ADMIN'))) {
      return reply.badRequest('Impossible de retirer ses propres droits administrateur');
    }
    const passwordHash = password && (await hashPassword(password));
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { ...data, ...(passwordHash && { passwordHash }) },
        select: userSelect,
      });
      // Le mot de passe n'est jamais journalisé, seulement le fait qu'il a été réinitialisé.
      await tx.auditLog.create({
        data: {
          actorId: request.currentUser.id,
          action: 'user.updated',
          changes: { userId: id, ...data, ...(password && { passwordReset: true }) },
        },
      });
      return user;
    });
  });
};
