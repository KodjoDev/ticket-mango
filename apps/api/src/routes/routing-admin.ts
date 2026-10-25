import type { Prisma, PrismaClient } from '@prisma/client';
import { OPTION_KEY_PATTERN, PRIORITIES } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors';
import { SETTING_KEYS, slaPolicySchema, type ConfigService } from '../services/config';

const idParams = z.object({ id: z.string().uuid() });
const optionKey = z.string().regex(OPTION_KEY_PATTERN);

const groupSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable(),
    distribution: z.enum(['ROUND_ROBIN', 'LOAD', 'MANUAL']),
    managerId: z.string().uuid().nullable(),
    memberIds: z.array(z.string().uuid()).max(200),
    isActive: z.boolean(),
  })
  .strict();

const ruleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    conditions: z
      .object({
        type: z.array(optionKey).optional(),
        component: z.array(optionKey).optional(),
        environment: z.array(optionKey).optional(),
        priority: z.array(z.enum(PRIORITIES)).optional(),
      })
      .strict(),
    groupId: z.string().uuid(),
    isActive: z.boolean(),
  })
  .strict();

const groupInclude = {
  members: { select: { user: { select: { id: true, name: true, role: true, isActive: true } } } },
  manager: { select: { id: true, name: true } },
  _count: { select: { tickets: true } },
} satisfies Prisma.GroupInclude;

/** Administration des groupes, du routage et des SLA (préfixe /admin). */
export const routingAdminRoutes: FastifyPluginAsync<{ prisma: PrismaClient; config: ConfigService }> = async (
  app,
  { prisma, config },
) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('settings:manage'));

  const audit = (actorId: string, action: string, changes: Prisma.InputJsonValue) =>
    prisma.auditLog.create({ data: { actorId, action, changes } });

  async function assertUsers(ids: string[]) {
    const found = await prisma.user.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) throw badRequest('Utilisateur inconnu');
  }

  // Groupes

  app.get('/groups', async () => {
    const groups = await prisma.group.findMany({ orderBy: { position: 'asc' }, include: groupInclude });
    return groups.map(({ members, _count, ...g }) => ({ ...g, members: members.map((m) => m.user), ticketCount: _count.tickets }));
  });

  app.post('/groups', async (request, reply) => {
    const { memberIds, ...data } = groupSchema.partial({ description: true, managerId: true, memberIds: true, isActive: true }).parse(request.body);
    await assertUsers([...(memberIds ?? []), ...(data.managerId ? [data.managerId] : [])]);
    const last = await prisma.group.findFirst({ orderBy: { position: 'desc' } });
    const group = await prisma.group.create({
      data: {
        ...data,
        position: (last?.position ?? -1) + 1,
        members: { create: [...new Set(memberIds ?? [])].map((userId) => ({ userId })) },
      },
    });
    await audit(request.currentUser.id, 'admin.group.created', { groupId: group.id, name: group.name });
    return reply.status(201).send(group);
  });

  app.patch('/groups/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const { memberIds, ...data } = groupSchema.partial().parse(request.body);
    if (!(await prisma.group.findUnique({ where: { id } }))) throw notFound('Groupe introuvable');
    await assertUsers([...(memberIds ?? []), ...(data.managerId ? [data.managerId] : [])]);
    const group = await prisma.$transaction(async (tx) => {
      if (memberIds) {
        await tx.groupMember.deleteMany({ where: { groupId: id } });
        await tx.groupMember.createMany({ data: [...new Set(memberIds)].map((userId) => ({ groupId: id, userId })) });
      }
      return tx.group.update({ where: { id }, data });
    });
    await audit(request.currentUser.id, 'admin.group.updated', { groupId: id, fields: Object.keys(request.body as object) });
    return group;
  });

  app.delete('/groups/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const used = await prisma.ticket.count({ where: { groupId: id } });
    if (used > 0) throw badRequest(`Groupe utilisé par ${used} ticket(s) : désactivez-le plutôt que de le supprimer`);
    await prisma.group.delete({ where: { id } });
    await audit(request.currentUser.id, 'admin.group.deleted', { groupId: id });
    return reply.status(204).send();
  });

  // Règles de routage

  app.get('/routing-rules', async () =>
    prisma.routingRule.findMany({ orderBy: { position: 'asc' }, include: { group: { select: { id: true, name: true } } } }),
  );

  app.post('/routing-rules', async (request, reply) => {
    const data = ruleSchema.partial({ isActive: true }).parse(request.body);
    const last = await prisma.routingRule.findFirst({ orderBy: { position: 'desc' } });
    const rule = await prisma.routingRule.create({ data: { ...data, position: (last?.position ?? -1) + 1 } });
    await audit(request.currentUser.id, 'admin.routing_rule.created', { ruleId: rule.id, name: rule.name });
    return reply.status(201).send(rule);
  });

  app.patch('/routing-rules/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const data = ruleSchema.partial().parse(request.body);
    const rule = await prisma.routingRule.update({ where: { id }, data });
    await audit(request.currentUser.id, 'admin.routing_rule.updated', { ruleId: id, fields: Object.keys(data) });
    return rule;
  });

  app.put('/routing-rules/order', async (request) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(request.body);
    const existing = await prisma.routingRule.findMany({ select: { id: true } });
    if (ids.length !== existing.length || !existing.every((r) => ids.includes(r.id))) {
      throw badRequest('La liste doit contenir exactement les règles existantes');
    }
    await prisma.$transaction(ids.map((id, position) => prisma.routingRule.update({ where: { id }, data: { position } })));
    await audit(request.currentUser.id, 'admin.routing_rule.reordered', { ids });
    return prisma.routingRule.findMany({ orderBy: { position: 'asc' }, include: { group: { select: { id: true, name: true } } } });
  });

  app.delete('/routing-rules/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await prisma.routingRule.delete({ where: { id } });
    await audit(request.currentUser.id, 'admin.routing_rule.deleted', { ruleId: id });
    return reply.status(204).send();
  });

  // Politique SLA

  app.put('/sla-policy', async (request) => {
    const policy = slaPolicySchema.parse(request.body);
    await prisma.$transaction(async (tx) => {
      await config.saveSetting(tx, SETTING_KEYS.slaPolicy, policy as unknown as Prisma.InputJsonValue);
      // Nouveaux délais : les alertes émises sous l'ancienne politique sont réarmées.
      await tx.slaAlert.deleteMany({});
    });
    await audit(request.currentUser.id, 'admin.sla_policy.updated', policy as unknown as Prisma.InputJsonValue);
    return policy;
  });
};
