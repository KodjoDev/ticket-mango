import type { PrismaClient } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { readMultipart } from '../lib/multipart';
import { MAX_RAW_EMAIL_BYTES, type InboundService } from '../services/email/inbound';

/**
 * Réception d'e-mails par webhook (préfixe /inbound) : l'URL contient le jeton secret de la boîte.
 * Formats acceptés : MIME brut (message/rfc822), ou formulaire multipart avec le message brut
 * dans le champ « email » (SendGrid, option « raw ») ou « body-mime » (Mailgun).
 */
export const inboundRoutes: FastifyPluginAsync<{ prisma: PrismaClient; inbound: InboundService }> = async (
  app,
  { prisma, inbound },
) => {
  app.addContentTypeParser(
    ['message/rfc822', 'application/octet-stream', 'text/plain'],
    { parseAs: 'buffer', bodyLimit: MAX_RAW_EMAIL_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.post(
    '/email/:token',
    { bodyLimit: MAX_RAW_EMAIL_BYTES, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { token } = z.object({ token: z.string().min(32).max(128) }).parse(request.params);
      const mailbox = await prisma.mailbox.findUnique({ where: { webhookToken: token } });
      if (!mailbox || !mailbox.isActive) return reply.notFound('Boîte de réception inconnue');

      let raw: Buffer | undefined;
      if (request.isMultipart()) {
        const { fields, files } = await readMultipart(request);
        const field = fields.email ?? fields['body-mime'];
        raw = field ? Buffer.from(field) : files.find((f) => ['email', 'body-mime', 'message'].includes(f.field))?.data;
      } else if (Buffer.isBuffer(request.body)) {
        raw = request.body;
      }
      if (!raw?.length) return reply.badRequest('Message brut attendu (message/rfc822 ou champ « email »)');

      // 200 même pour un message écarté : le fournisseur ne doit pas le renvoyer en boucle.
      const result = await inbound.process(raw, mailbox.id);
      return { status: result.status, ticketId: result.ticketId ?? null };
    },
  );
};
