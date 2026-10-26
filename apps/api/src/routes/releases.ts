import { RELEASE_CATEGORIES } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ReleaseService } from '../services/releases';

const idParams = z.object({ id: z.string().uuid() });
const ticketId = z.coerce.number().int().positive();

/** Versions de livraison (préfixe /releases). Lecture : support ; écriture : release:manage. */
export const releaseRoutes: FastifyPluginAsync<{ releases: ReleaseService }> = async (app, { releases }) => {
  app.addHook('preHandler', app.authenticate);
  const manage = { preHandler: app.requirePermission('release:manage') };
  const read = { preHandler: app.requirePermission('ticket:read:all') };

  app.get('/', read, async () => releases.list());
  app.get('/:id', read, async (request) => releases.get(idParams.parse(request.params).id));
  app.get('/:id/candidates', manage, async (request) => releases.candidates(idParams.parse(request.params).id));

  app.post('/', manage, async (request, reply) => {
    const input = z
      .object({ version: z.string().trim().min(1).max(50), title: z.string().trim().max(200).nullish() })
      .strict()
      .parse(request.body);
    return reply.status(201).send(await releases.create(request.currentUser, input));
  });

  app.delete('/:id', manage, async (request, reply) => {
    await releases.remove(request.currentUser, idParams.parse(request.params).id);
    return reply.status(204).send();
  });

  app.post('/:id/tickets', manage, async (request) => {
    const { ticketIds } = z.object({ ticketIds: z.array(ticketId).min(1).max(200) }).strict().parse(request.body);
    return releases.addTickets(request.currentUser, idParams.parse(request.params).id, ticketIds);
  });

  app.patch('/:id/tickets/:ticketId', manage, async (request) => {
    const { id, ticketId: t } = idParams.extend({ ticketId }).parse(request.params);
    const input = z
      .object({ category: z.enum(RELEASE_CATEGORIES), summary: z.string().trim().max(1000).nullable() })
      .partial()
      .strict()
      .parse(request.body);
    return releases.updateItem(request.currentUser, id, t, { ...input, ...(input.summary === '' && { summary: null }) });
  });

  app.delete('/:id/tickets/:ticketId', manage, async (request) => {
    const { id, ticketId: t } = idParams.extend({ ticketId }).parse(request.params);
    return releases.removeTicket(request.currentUser, id, t);
  });

  app.post('/:id/publish', manage, async (request) => {
    const { notify } = z.object({ notify: z.boolean() }).strict().parse(request.body);
    return releases.publish(request.currentUser, idParams.parse(request.params).id, notify);
  });

  app.post('/:id/notify', manage, async (request) => releases.notify(request.currentUser, idParams.parse(request.params).id));
};

/** Portail public des nouveautés, sans connexion (préfixe /public/releases). */
export const publicReleaseRoutes: FastifyPluginAsync<{ releases: ReleaseService }> = async (app, { releases }) => {
  app.get('/', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async () => releases.publicList());
};
