import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { LanguageToolClient } from '../services/spellcheck';

/** Correction orthographique et grammaticale des messages (préfixe /spellcheck). */
export const spellcheckRoutes: FastifyPluginAsync<{ client: LanguageToolClient | null }> = async (app, { client }) => {
  app.post(
    '/',
    { preHandler: [app.authenticate, app.requirePermission('comment:create')], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!client) return reply.serviceUnavailable('Correcteur non configuré (LANGUAGETOOL_URL)');
      const { text } = z.object({ text: z.string().min(1).max(20_000) }).strict().parse(request.body);
      return { issues: await client.check(text) };
    },
  );
};
