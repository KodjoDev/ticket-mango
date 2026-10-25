import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { NotificationService } from '../services/notifications';

/** Notifications de l'utilisateur connecté (préfixe /notifications). */
export const notificationRoutes: FastifyPluginAsync<{ notifications: NotificationService }> = async (
  app,
  { notifications },
) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => notifications.list(request.currentUser.id));

  app.post('/:id/read', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await notifications.markRead(request.currentUser.id, id);
    return reply.status(204).send();
  });

  app.post('/read-all', async (request, reply) => {
    await notifications.markRead(request.currentUser.id);
    return reply.status(204).send();
  });
};
