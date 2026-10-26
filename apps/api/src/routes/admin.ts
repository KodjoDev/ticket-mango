import type { Prisma, PrismaClient } from '@prisma/client';
import {
  LIST_COLUMNS,
  LOCKED_PAGE_BLOCKS,
  PAGE_BLOCK_LABELS,
  PAGE_BLOCKS,
  PAGE_COLUMNS,
  OPTION_FIELD_TICKET_KEY,
  OPTION_FIELDS,
  OPTION_KEY_PATTERN,
  PRIORITIES,
  SLA_STATES,
  TICKET_FORM_FIELDS,
  TICKET_STATUSES,
} from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../lib/errors';
import { priorityMatrixSchema, SETTING_KEYS, type ConfigService } from '../services/config';

type Tx = Prisma.TransactionClient;

const idParams = z.object({ id: z.string().uuid() });
const label = z.string().trim().min(1).max(100);
const optionKey = z.string().regex(OPTION_KEY_PATTERN, 'Clé invalide : majuscules, chiffres et _ (ex. MOBILE_APP)');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur attendue au format #rrggbb');

/** Mise en page : chaque élément connu exactement une fois, dans l'ordre voulu. */
const layoutSchema = <T extends readonly [string, ...string[]]>(keys: T) =>
  z
    .array(z.object({ key: z.enum(keys), visible: z.boolean() }).strict())
    .refine((items) => items.length === keys.length && new Set(items.map((i) => i.key)).size === keys.length, {
      message: 'Chaque élément doit apparaître une et une seule fois',
    });

const viewFiltersSchema = z
  .object({
    status: z.union([z.literal('open'), z.array(z.enum(TICKET_STATUSES)).min(1)]).optional(),
    priority: z.array(z.enum(PRIORITIES)).min(1).optional(),
    type: optionKey.optional(),
    component: optionKey.optional(),
    assignee: z.union([z.literal('me'), z.literal('none'), z.string().uuid()]).optional(),
    group: z.union([z.literal('mine'), z.string().uuid()]).optional(),
    slaState: z.array(z.enum(SLA_STATES)).min(1).optional(),
    awaitingAgent: z.boolean().optional(),
    tagId: z.string().uuid().optional(),
  })
  .strict();

const orderSchema = z.object({ ids: z.array(z.string().uuid()).min(1) });

/** Applique un nouvel ordre ; `ids` doit contenir exactement les éléments existants. */
async function reorder(existing: string[], ids: string[], update: (id: string, position: number) => Promise<unknown>) {
  if (ids.length !== existing.length || !existing.every((id) => ids.includes(id))) {
    throw badRequest("La liste doit contenir exactement les éléments existants");
  }
  await Promise.all(ids.map((id, position) => update(id, position)));
}

export const adminRoutes: FastifyPluginAsync<{ prisma: PrismaClient; config: ConfigService }> = async (
  app,
  { prisma, config },
) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('settings:manage'));

  /** Chaque action d'administration est tracée dans le journal d'audit (sans ticket associé). */
  const withAudit = <T>(actorId: string, action: string, run: (tx: Tx) => Promise<T>, changes?: (r: T) => unknown) =>
    prisma.$transaction(async (tx) => {
      const result = await run(tx);
      await tx.auditLog.create({
        data: { actorId, action, changes: (changes ? changes(result) : result) as Prisma.InputJsonValue },
      });
      return result;
    });

  // Listes de qualification

  app.post('/options', async (request, reply) => {
    const data = z.object({ field: z.enum(OPTION_FIELDS), key: optionKey, label }).strict().parse(request.body);
    const option = await withAudit(request.currentUser.id, 'admin.option.created', async (tx) => {
      const last = await tx.fieldOption.findFirst({ where: { field: data.field }, orderBy: { position: 'desc' } });
      return tx.fieldOption.create({ data: { ...data, position: (last?.position ?? -1) + 1 } });
    });
    return reply.status(201).send(option);
  });

  app.patch('/options/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const data = z.object({ label, isActive: z.boolean() }).partial().strict().parse(request.body);
    const option = await prisma.fieldOption.findUnique({ where: { id } });
    if (!option) throw notFound('Valeur introuvable');
    if (option.isSystem && data.isActive === false) {
      throw badRequest('Cette valeur est utilisée par le fonctionnement de l’application et ne peut pas être archivée');
    }
    return withAudit(
      request.currentUser.id,
      'admin.option.updated',
      (tx) => tx.fieldOption.update({ where: { id }, data }),
      () => ({ field: option.field, key: option.key, ...data }),
    );
  });

  app.put('/options/order', async (request) => {
    const { field, ids } = orderSchema.extend({ field: z.enum(OPTION_FIELDS) }).parse(request.body);
    const existing = await prisma.fieldOption.findMany({ where: { field }, select: { id: true } });
    await withAudit(
      request.currentUser.id,
      'admin.option.reordered',
      (tx) => reorder(existing.map((o) => o.id), ids, (id, position) => tx.fieldOption.update({ where: { id }, data: { position } })),
      () => ({ field }),
    );
    return config.options();
  });

  app.delete('/options/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const option = await prisma.fieldOption.findUnique({ where: { id } });
    if (!option) throw notFound('Valeur introuvable');
    if (option.isSystem) throw badRequest('Cette valeur système ne peut pas être supprimée');
    const used = await prisma.ticket.count({ where: { [OPTION_FIELD_TICKET_KEY[option.field]]: option.key } });
    if (used > 0) throw conflict(`Valeur utilisée par ${used} ticket(s) : archivez-la plutôt que de la supprimer`);
    await withAudit(
      request.currentUser.id,
      'admin.option.deleted',
      (tx) => tx.fieldOption.delete({ where: { id } }),
      () => ({ field: option.field, key: option.key }),
    );
    return reply.status(204).send();
  });

  // Matrice de priorité

  app.put('/priority-matrix', async (request) => {
    const matrix = priorityMatrixSchema.parse(request.body);
    const previous = await config.priorityMatrix();
    await withAudit(
      request.currentUser.id,
      'admin.priority_matrix.updated',
      (tx) => config.saveSetting(tx, SETTING_KEYS.priorityMatrix, matrix as unknown as Prisma.InputJsonValue),
      () => ({ from: previous, to: matrix }),
    );
    return matrix;
  });

  // Mise en page

  app.put('/layout/ticket-form', async (request) => {
    const layout = layoutSchema(TICKET_FORM_FIELDS).parse(request.body);
    await withAudit(
      request.currentUser.id,
      'admin.layout.ticket_form.updated',
      (tx) => config.saveSetting(tx, SETTING_KEYS.ticketForm, layout),
      () => layout,
    );
    return layout;
  });

  app.put('/layout/ticket-page', async (request) => {
    const layout = z
      .array(z.object({ key: z.enum(PAGE_BLOCKS), visible: z.boolean(), column: z.enum(PAGE_COLUMNS) }).strict())
      .refine((items) => items.length === PAGE_BLOCKS.length && new Set(items.map((i) => i.key)).size === PAGE_BLOCKS.length, {
        message: 'Chaque bloc doit apparaître une et une seule fois',
      })
      .parse(request.body);
    for (const key of LOCKED_PAGE_BLOCKS) {
      if (!layout.find((i) => i.key === key)?.visible) throw badRequest(`Le bloc « ${PAGE_BLOCK_LABELS[key]} » doit rester affiché`);
    }
    await withAudit(
      request.currentUser.id,
      'admin.layout.ticket_page.updated',
      (tx) => config.saveSetting(tx, SETTING_KEYS.ticketPage, layout),
      () => layout,
    );
    return layout;
  });

  app.put('/layout/list-columns', async (request) => {
    const layout = layoutSchema(LIST_COLUMNS).parse(request.body);
    // Le sujet est le lien vers le ticket : il doit rester affiché.
    if (!layout.find((c) => c.key === 'subject')?.visible) throw badRequest('La colonne « Sujet » doit rester visible');
    await withAudit(
      request.currentUser.id,
      'admin.layout.list_columns.updated',
      (tx) => config.saveSetting(tx, SETTING_KEYS.listColumns, layout),
      () => layout,
    );
    return layout;
  });

  // Tags

  app.post('/tags', async (request, reply) => {
    const data = z.object({ name: label, color }).strict().parse(request.body);
    const tag = await withAudit(request.currentUser.id, 'admin.tag.created', (tx) => tx.tag.create({ data }));
    return reply.status(201).send(tag);
  });

  app.patch('/tags/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const data = z.object({ name: label, color, isActive: z.boolean() }).partial().strict().parse(request.body);
    return withAudit(request.currentUser.id, 'admin.tag.updated', (tx) => tx.tag.update({ where: { id }, data }));
  });

  app.delete('/tags/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const used = await prisma.ticketTag.count({ where: { tagId: id } });
    if (used > 0) throw conflict(`Tag utilisé par ${used} ticket(s) : archivez-le plutôt que de le supprimer`);
    await withAudit(request.currentUser.id, 'admin.tag.deleted', (tx) => tx.tag.delete({ where: { id } }));
    return reply.status(204).send();
  });

  // Vues

  const viewSchema = z.object({ name: label, filters: viewFiltersSchema }).strict();

  app.post('/views', async (request, reply) => {
    const data = viewSchema.parse(request.body);
    const view = await withAudit(request.currentUser.id, 'admin.view.created', async (tx) => {
      const last = await tx.view.findFirst({ orderBy: { position: 'desc' } });
      return tx.view.create({ data: { ...data, position: (last?.position ?? -1) + 1 } });
    });
    return reply.status(201).send(view);
  });

  app.patch('/views/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const data = viewSchema.partial().parse(request.body);
    return withAudit(request.currentUser.id, 'admin.view.updated', (tx) => tx.view.update({ where: { id }, data }));
  });

  app.put('/views/order', async (request) => {
    const { ids } = orderSchema.parse(request.body);
    const existing = await prisma.view.findMany({ select: { id: true } });
    await withAudit(
      request.currentUser.id,
      'admin.view.reordered',
      (tx) => reorder(existing.map((v) => v.id), ids, (id, position) => tx.view.update({ where: { id }, data: { position } })),
      () => ({ ids }),
    );
    return prisma.view.findMany({ orderBy: { position: 'asc' } });
  });

  app.delete('/views/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await withAudit(request.currentUser.id, 'admin.view.deleted', (tx) => tx.view.delete({ where: { id } }));
    return reply.status(204).send();
  });
};
