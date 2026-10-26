import type { PrismaClient } from '@prisma/client';
import { CUSTOM_FIELD_KEY_PATTERN, CUSTOM_FIELD_KINDS } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { badRequest, conflict } from '../lib/errors';

const idParams = z.object({ id: z.string().uuid() });
const MAX_FIELDS = 30;

const choices = z.array(z.string().trim().min(1).max(100)).min(1).max(50);

const createSchema = z
  .object({
    key: z.string().regex(CUSTOM_FIELD_KEY_PATTERN, 'Clé : minuscules, chiffres et _, 2 à 40 caractères, commençant par une lettre'),
    label: z.string().trim().min(1).max(100),
    kind: z.enum(CUSTOM_FIELD_KINDS),
    options: choices.optional(),
    required: z.boolean().default(false),
    forRequester: z.boolean().default(false),
  })
  .strict();

// La clé et le type sont figés : les valeurs déjà saisies resteraient incohérentes.
const updateSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    options: choices,
    required: z.boolean(),
    forRequester: z.boolean(),
    isActive: z.boolean(),
  })
  .partial()
  .strict();

/** Champs personnalisés des tickets (préfixe /admin). */
export const customFieldAdminRoutes: FastifyPluginAsync<{ prisma: PrismaClient }> = async (app, { prisma }) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('settings:manage'));

  const audit = (actorId: string, action: string, field: { id: string; key: string }) =>
    prisma.auditLog.create({ data: { actorId, action, changes: { fieldId: field.id, key: field.key } } });

  app.get('/custom-fields', async () => prisma.customField.findMany({ orderBy: { position: 'asc' } }));

  app.post('/custom-fields', async (request, reply) => {
    const input = createSchema.parse(request.body);
    if (input.kind === 'SELECT' && !input.options) throw badRequest('Une liste de choix doit proposer au moins un choix');
    if (input.kind !== 'SELECT' && input.options) throw badRequest('Seule une liste de choix a des options');
    if (input.kind === 'CHECKBOX' && input.required) throw badRequest('Une case à cocher ne peut pas être obligatoire');
    if (await prisma.customField.findUnique({ where: { key: input.key } })) throw conflict('Cette clé est déjà utilisée');
    if ((await prisma.customField.count()) >= MAX_FIELDS) throw conflict(`Au plus ${MAX_FIELDS} champs personnalisés`);
    const last = await prisma.customField.aggregate({ _max: { position: true } });
    const field = await prisma.customField.create({
      data: { ...input, options: input.options ?? [], position: (last._max.position ?? -1) + 1 },
    });
    await audit(request.currentUser.id, 'admin.custom_field.created', field);
    return reply.status(201).send(field);
  });

  app.patch('/custom-fields/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const input = updateSchema.parse(request.body);
    const current = await prisma.customField.findUniqueOrThrow({ where: { id } });
    if (input.options && current.kind !== 'SELECT') throw badRequest('Seule une liste de choix a des options');
    if (input.required && current.kind === 'CHECKBOX') throw badRequest('Une case à cocher ne peut pas être obligatoire');
    // Retirer un choix déjà utilisé ne réécrit pas les tickets : la valeur reste affichée, mais n'est plus proposée.
    const field = await prisma.customField.update({ where: { id }, data: input });
    await audit(request.currentUser.id, input.isActive === false ? 'admin.custom_field.archived' : 'admin.custom_field.updated', field);
    return field;
  });

  app.put('/custom-fields/order', async (request) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).max(MAX_FIELDS) }).strict().parse(request.body);
    const existing = await prisma.customField.findMany({ select: { id: true } });
    if (ids.length !== existing.length || !existing.every((f) => ids.includes(f.id))) throw badRequest("L'ordre doit contenir tous les champs");
    await prisma.$transaction(ids.map((id, position) => prisma.customField.update({ where: { id }, data: { position } })));
    return prisma.customField.findMany({ orderBy: { position: 'asc' } });
  });
};
