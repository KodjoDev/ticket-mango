import type { Prisma, PrismaClient } from '@prisma/client';
import { hasPermission } from '@ticketing/shared';
import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { badRequest, notFound } from '../lib/errors';
import type { CurrentUser } from '../plugins/auth';
import type { FileStorage } from './storage';

type Db = PrismaClient | Prisma.TransactionClient;

/** Taille maximale d'une pièce jointe (le CdC demande au moins 25 Mo par e-mail). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface IncomingFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

/** Nom de fichier affichable : sans chemin ni caractères de contrôle. */
export function safeFilename(name: string): string {
  const cleaned = basename(name.replace(/\\/g, '/'))
    // Caractères de contrôle retirés volontairement (en-têtes HTTP, affichage).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .trim()
    .slice(0, 200);
  return cleaned || 'piece-jointe';
}

/** Types affichables dans le navigateur ; tout le reste est proposé au téléchargement. */
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
export const isInlineType = (type: string) => INLINE_TYPES.has(type.toLowerCase());

export const attachmentSelect = { id: true, filename: true, contentType: true, size: true, createdAt: true } as const;

export class AttachmentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: FileStorage,
  ) {}

  async save(db: Db, ticketId: number, commentId: string | null, file: IncomingFile, uploadedById: string | null) {
    if (file.data.length > MAX_ATTACHMENT_BYTES) {
      throw badRequest(`« ${safeFilename(file.filename)} » dépasse ${MAX_ATTACHMENT_BYTES / 1024 / 1024} Mo`);
    }
    const id = randomUUID();
    // Clé interne uniquement : le nom d'origine n'entre jamais dans le chemin.
    const storageKey = `attachments/${id.slice(0, 2)}/${id}`;
    await this.storage.put(storageKey, file.data);
    return db.attachment.create({
      data: {
        id,
        ticketId,
        commentId,
        filename: safeFilename(file.filename),
        contentType: file.contentType.toLowerCase().split(';')[0]!.trim() || 'application/octet-stream',
        size: file.data.length,
        sha256: createHash('sha256').update(file.data).digest('hex'),
        storageKey,
        uploadedById,
      },
      select: attachmentSelect,
    });
  }

  /** Pièce jointe lisible par l'utilisateur : ticket visible, et pas une note interne pour un externe. */
  async openForUser(user: CurrentUser, id: string) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id },
      include: { ticket: { select: { requesterId: true } }, comment: { select: { isInternal: true } } },
    });
    const canReadAll = hasPermission(user.role, 'ticket:read:all');
    if (
      !attachment ||
      (!canReadAll && attachment.ticket.requesterId !== user.id) ||
      (attachment.comment?.isInternal && !hasPermission(user.role, 'comment:internal'))
    ) {
      throw notFound('Pièce jointe introuvable');
    }
    return { attachment, stream: await this.storage.get(attachment.storageKey) };
  }

  read(storageKey: string) {
    return this.storage.get(storageKey);
  }
}
