import { CUSTOM_FIELD_KEY_PATTERN, IMPACTS, OPTION_KEY_PATTERN, PRIORITIES, SLA_STATES, TICKET_STATUSES, URGENCIES } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { readMultipart } from '../lib/multipart';
import { isStaff, type TicketService } from '../services/tickets';

const subject = z.string().trim().min(1).max(250);
const description = z.string().trim().min(1).max(50_000);
// Les valeurs de liste sont administrables : leur existence est vérifiée par le service.
const optionKey = z.string().regex(OPTION_KEY_PATTERN, 'Clé de liste invalide');

const customValues = z.record(z.string().regex(CUSTOM_FIELD_KEY_PATTERN), z.union([z.string().max(5000), z.number(), z.boolean(), z.null()]));

const staffCreateSchema = z
  .object({
    subject,
    description,
    type: optionKey.optional(),
    component: optionKey.nullable().optional(),
    environment: optionKey.nullable().optional(),
    impact: z.enum(IMPACTS).optional(),
    urgency: z.enum(URGENCIES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    requesterId: z.string().uuid().optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    groupId: z.string().uuid().nullable().optional(),
    tagIds: z.array(z.string().uuid()).max(50).optional(),
    customValues: customValues.optional(),
  })
  .strict();

// Un utilisateur externe décrit sa demande ; la qualification (impact, urgence, priorité) revient au support.
const externalCreateSchema = staffCreateSchema
  .pick({ subject: true, description: true, type: true, component: true, environment: true, customValues: true })
  .strict();

const updateSchema = staffCreateSchema
  .extend({ priority: z.enum(PRIORITIES).nullable() })
  .partial()
  .strict();

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1))
    .optional();

const listQuerySchema = z.object({
  status: csv(TICKET_STATUSES),
  priority: csv(PRIORITIES),
  type: optionKey.optional(),
  component: optionKey.optional(),
  assigneeId: z.union([z.string().uuid(), z.literal('none')]).optional(),
  /** Identifiant de groupe ou « mine » (groupes de l'agent connecté). */
  groupId: z.union([z.string().uuid(), z.literal('mine')]).optional(),
  slaState: csv(SLA_STATES),
  sort: z.enum(['created', 'sla']).default('created'),
  tagId: z.string().uuid().optional(),
  awaitingAgent: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const idParams = z.object({ id: z.coerce.number().int().positive() });
const transitionSchema = z.object({ status: z.enum(TICKET_STATUSES) }).strict();
const commentSchema = z
  .object({ body: z.string().trim().min(1).max(50_000), isInternal: z.boolean().default(false) })
  .strict();

export const ticketRoutes: FastifyPluginAsync<{ tickets: TicketService }> = async (app, { tickets }) => {
  app.addHook('preHandler', app.authenticate);

  // Un demandeur ne voit que les champs personnalisés qui lui sont ouverts.
  app.addHook('preSerialization', async (request, _reply, payload) => {
    if (!request.currentUser || isStaff(request.currentUser) || payload === null || typeof payload !== 'object') return payload;
    const allowed = await tickets.requesterFieldKeys();
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(strip);
      if (value === null || typeof value !== 'object' || value instanceof Date) return value;
      const record = { ...(value as Record<string, unknown>) };
      if (record.customValues && typeof record.customValues === 'object') {
        record.customValues = Object.fromEntries(Object.entries(record.customValues).filter(([k]) => allowed.has(k)));
      }
      if (Array.isArray(record.items)) record.items = record.items.map(strip);
      if (Array.isArray(record.children)) record.children = record.children.map(strip);
      return record;
    };
    return strip(payload);
  });

  app.get('/', async (request) => {
    const { groupId, ...query } = listQuerySchema.parse(request.query);
    const groupIds =
      groupId === 'mine' ? await tickets.userGroupIds(request.currentUser.id) : groupId ? [groupId] : undefined;
    return tickets.list(request.currentUser, { ...query, groupIds });
  });

  app.post('/', { preHandler: app.requirePermission('ticket:create') }, async (request, reply) => {
    const schema = isStaff(request.currentUser) ? staffCreateSchema : externalCreateSchema;
    const ticket = await tickets.create(request.currentUser, schema.parse(request.body));
    return reply.status(201).send(ticket);
  });

  app.get('/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return tickets.getDetail(request.currentUser, id);
  });

  app.put('/:id/parent', async (request) => {
    const { id } = idParams.parse(request.params);
    const { parentId } = z.object({ parentId: z.number().int().positive().nullable() }).strict().parse(request.body);
    return tickets.setParent(request.currentUser, id, parentId);
  });

  app.patch('/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return tickets.update(request.currentUser, id, updateSchema.parse(request.body));
  });

  app.post('/:id/route', async (request) => {
    const { id } = idParams.parse(request.params);
    return tickets.route(request.currentUser, id);
  });

  app.post('/:id/status', async (request) => {
    const { id } = idParams.parse(request.params);
    const { status } = transitionSchema.parse(request.body);
    return tickets.transition(request.currentUser, id, status);
  });

  app.get('/:id/comments', async (request) => {
    const { id } = idParams.parse(request.params);
    return tickets.listComments(request.currentUser, id);
  });

  // JSON, ou multipart (champs body/isInternal + fichiers) pour joindre des pièces.
  app.post('/:id/comments', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    let payload: unknown = request.body;
    let files: Awaited<ReturnType<typeof readMultipart>>['files'] = [];
    if (request.isMultipart()) {
      const form = await readMultipart(request);
      payload = { body: form.fields.body, isInternal: form.fields.isInternal === 'true' };
      files = form.files;
    }
    const { body, isInternal } = commentSchema.parse(payload);
    const comment = await tickets.addComment(request.currentUser, id, body, isInternal, { files });
    return reply.status(201).send(comment);
  });

  app.post('/:id/attachments', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    if (!request.isMultipart()) return reply.badRequest('Formulaire multipart attendu');
    const { files } = await readMultipart(request);
    if (files.length === 0) return reply.badRequest('Aucun fichier reçu');
    return reply.status(201).send(await tickets.addAttachments(request.currentUser, id, files));
  });

  app.post('/:id/merge', async (request) => {
    const { id } = idParams.parse(request.params);
    const { targetId } = z.object({ targetId: z.number().int().positive() }).strict().parse(request.body);
    return tickets.merge(request.currentUser, id, targetId);
  });

  app.get('/:id/requester-history', async (request) => {
    const { id } = idParams.parse(request.params);
    return tickets.requesterHistory(request.currentUser, id);
  });

  app.get('/:id/audit', async (request) => {
    const { id } = idParams.parse(request.params);
    return tickets.auditTrail(request.currentUser, id);
  });
};
