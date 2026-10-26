import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { isInlineType, type AttachmentService } from '../services/attachments';

/** Téléchargement des pièces jointes (préfixe /attachments). */
export const attachmentRoutes: FastifyPluginAsync<{ attachments: AttachmentService }> = async (app, { attachments }) => {
  app.get('/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { attachment, stream } = await attachments.openForUser(request.currentUser, id);
    const inline = isInlineType(attachment.contentType);
    // Seuls images et PDF s'affichent ; tout le reste est téléchargé, jamais interprété par le navigateur.
    return reply
      .header('Content-Type', inline ? attachment.contentType : 'application/octet-stream')
      .header(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      )
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
      .header('Cache-Control', 'private, max-age=300')
      .send(stream);
  });
};
