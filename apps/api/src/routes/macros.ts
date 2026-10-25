import type { Prisma, PrismaClient } from '@prisma/client';
import { TICKET_STATUSES, unknownVariables } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors';
import type { MacroService } from '../services/macros';

const idParams = z.object({ id: z.string().uuid() });

const actionsSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    addTagIds: z.array(z.string().uuid()).max(20).optional(),
    assignToMe: z.boolean().optional(),
  })
  .strict();

const macroSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(20_000),
    isInternal: z.boolean(),
    actions: actionsSchema,
    isActive: z.boolean(),
  })
  .strict();

function assertKnownVariables(body: string | undefined) {
  const unknown = body ? unknownVariables(body) : [];
  if (unknown.length) throw badRequest(`Variable(s) inconnue(s) : ${unknown.map((v) => `{{${v}}}`).join(', ')}`);
}

/** Macros : lecture et application par le support (préfixe /macros). */
export const macroRoutes: FastifyPluginAsync<{ macros: MacroService }> = async (app, { macros }) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('ticket:qualify'));

  app.get('/', async () => macros.list(false));

  app.post('/:id/apply', async (request) => {
    const { id } = idParams.parse(request.params);
    const { ticketId, body } = z
      .object({ ticketId: z.number().int().positive(), body: z.string().trim().min(1).max(50_000) })
      .strict()
      .parse(request.body);
    return macros.apply(request.currentUser, ticketId, id, body);
  });
};

/** Administration des macros (préfixe /admin/macros). */
export const macroAdminRoutes: FastifyPluginAsync<{ prisma: PrismaClient; macros: MacroService }> = async (
  app,
  { prisma, macros },
) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('settings:manage'));

  const audit = (actorId: string, action: string, changes: Prisma.InputJsonValue) =>
    prisma.auditLog.create({ data: { actorId, action, changes } });

  app.get('/', async () => macros.list(true));

  app.post('/', async (request, reply) => {
    const data = macroSchema.partial({ isActive: true }).parse(request.body);
    assertKnownVariables(data.body);
    const last = await prisma.macro.findFirst({ orderBy: { position: 'desc' } });
    const macro = await prisma.macro.create({ data: { ...data, position: (last?.position ?? -1) + 1 } });
    await audit(request.currentUser.id, 'admin.macro.created', { macroId: macro.id, name: macro.name });
    return reply.status(201).send(macro);
  });

  app.patch('/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const data = macroSchema.partial().parse(request.body);
    assertKnownVariables(data.body);
    const current = await prisma.macro.findUnique({ where: { id } });
    if (!current) throw notFound('Macro introuvable');
    // Une macro système reste active : l'application en a besoin pour les rendez-vous.
    if (current.systemKey && data.isActive === false) throw badRequest('Une macro système ne peut pas être désactivée');
    const macro = await prisma.macro.update({ where: { id }, data });
    await audit(request.currentUser.id, 'admin.macro.updated', { macroId: id, fields: Object.keys(data) });
    return macro;
  });

  app.put('/order', async (request) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(request.body);
    const existing = await prisma.macro.findMany({ select: { id: true } });
    if (ids.length !== existing.length || !existing.every((m) => ids.includes(m.id))) {
      throw badRequest('La liste doit contenir exactement les macros existantes');
    }
    await prisma.$transaction(ids.map((id, position) => prisma.macro.update({ where: { id }, data: { position } })));
    await audit(request.currentUser.id, 'admin.macro.reordered', { ids });
    return macros.list(true);
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const macro = await prisma.macro.findUnique({ where: { id } });
    if (!macro) throw notFound('Macro introuvable');
    if (macro.systemKey) throw badRequest('Une macro système ne peut pas être supprimée');
    await prisma.macro.delete({ where: { id } });
    await audit(request.currentUser.id, 'admin.macro.deleted', { macroId: id, name: macro.name });
    return reply.status(204).send();
  });
};
