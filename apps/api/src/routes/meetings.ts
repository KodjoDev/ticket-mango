import type { PrismaClient } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { MeetingService } from '../services/meetings/service';

const ticketParams = z.object({ id: z.coerce.number().int().positive() });
const meetingParams = ticketParams.extend({ meetingId: z.string().uuid() });

const createSchema = z
  .object({
    mode: z.enum(['direct', 'proposal']),
    title: z.string().trim().max(200).optional(),
    durationMinutes: z.number().int().min(15).max(240),
    slots: z.array(z.coerce.date()).min(1).max(5),
    developerIds: z.array(z.string().uuid()).max(10).default([]),
  })
  .strict();

/** Rendez-vous d'un ticket (préfixe /tickets). */
export const meetingRoutes: FastifyPluginAsync<{ meetings: MeetingService }> = async (app, { meetings }) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/:id/meetings', async (request) => {
    const { id } = ticketParams.parse(request.params);
    return meetings.list(request.currentUser, id);
  });

  app.post('/:id/meetings', async (request, reply) => {
    const { id } = ticketParams.parse(request.params);
    const meeting = await meetings.create(request.currentUser, id, createSchema.parse(request.body));
    return reply.status(201).send(meeting);
  });

  app.post('/:id/meetings/:meetingId/cancel', async (request) => {
    const { id, meetingId } = meetingParams.parse(request.params);
    return meetings.cancel(request.currentUser, id, meetingId);
  });
};

/** Développeurs invitables à un rendez-vous. */
export const developerRoutes: FastifyPluginAsync<{ prisma: PrismaClient }> = async (app, { prisma }) => {
  app.get('/', { preHandler: [app.authenticate, app.requirePermission('meeting:create')] }, async () =>
    prisma.user.findMany({
      where: { isActive: true, role: 'DEVELOPER' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  );
};

const tokenParams = z.object({ token: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/) });

/** Page publique de réservation : le jeton suffit, sans session. Limitée en débit contre l'énumération. */
export const bookingRoutes: FastifyPluginAsync<{ meetings: MeetingService }> = async (app, { meetings }) => {
  const rateLimit = { max: 30, timeWindow: '1 minute' };

  app.get('/:token', { config: { rateLimit } }, async (request) => {
    const { token } = tokenParams.parse(request.params);
    return meetings.getBooking(token);
  });

  app.post('/:token', { config: { rateLimit } }, async (request) => {
    const { token } = tokenParams.parse(request.params);
    const { slotId } = z.object({ slotId: z.string().uuid() }).strict().parse(request.body);
    return meetings.book(token, slotId);
  });
};
