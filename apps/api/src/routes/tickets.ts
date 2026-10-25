import type { PrismaClient } from '@prisma/client';
import {
  COMPONENTS,
  ENVIRONMENTS,
  IMPACTS,
  PRIORITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  URGENCIES,
} from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { isStaff, TicketService } from '../services/tickets';

const subject = z.string().trim().min(1).max(250);
const description = z.string().trim().min(1).max(50_000);

const staffCreateSchema = z
  .object({
    subject,
    description,
    type: z.enum(TICKET_TYPES).optional(),
    component: z.enum(COMPONENTS).nullable().optional(),
    environment: z.enum(ENVIRONMENTS).nullable().optional(),
    impact: z.enum(IMPACTS).optional(),
    urgency: z.enum(URGENCIES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    requesterId: z.string().uuid().optional(),
    assigneeId: z.string().uuid().nullable().optional(),
  })
  .strict();

// Un utilisateur externe décrit sa demande ; la qualification (impact, urgence, priorité) revient au support.
const externalCreateSchema = staffCreateSchema
  .pick({ subject: true, description: true, type: true, component: true, environment: true })
  .strict();

const updateSchema = staffCreateSchema
  .omit({ requesterId: true })
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
  type: z.enum(TICKET_TYPES).optional(),
  component: z.enum(COMPONENTS).optional(),
  assigneeId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const idParams = z.object({ id: z.coerce.number().int().positive() });
const transitionSchema = z.object({ status: z.enum(TICKET_STATUSES) }).strict();
const commentSchema = z
  .object({ body: z.string().trim().min(1).max(50_000), isInternal: z.boolean().default(false) })
  .strict();

export const ticketRoutes: FastifyPluginAsync<{ prisma: PrismaClient }> = async (app, { prisma }) => {
  const tickets = new TicketService(prisma);

  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => tickets.list(request.currentUser, listQuerySchema.parse(request.query)));

  app.post('/', { preHandler: app.requirePermission('ticket:create') }, async (request, reply) => {
    const schema = isStaff(request.currentUser) ? staffCreateSchema : externalCreateSchema;
    const ticket = await tickets.create(request.currentUser, schema.parse(request.body));
    return reply.status(201).send(ticket);
  });

  app.get('/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return tickets.getVisible(request.currentUser, id);
  });

  app.patch('/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return tickets.update(request.currentUser, id, updateSchema.parse(request.body));
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

  app.post('/:id/comments', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { body, isInternal } = commentSchema.parse(request.body);
    const comment = await tickets.addComment(request.currentUser, id, body, isInternal);
    return reply.status(201).send(comment);
  });

  app.get('/:id/audit', async (request) => {
    const { id } = idParams.parse(request.params);
    return tickets.auditTrail(request.currentUser, id);
  });
};
