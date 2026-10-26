import type { PrismaClient } from '@prisma/client';
import { badRequest, conflict, notFound } from '../lib/errors';
import type { FileStorage } from './storage';

export const ANONYMOUS_DOMAIN = 'anonymise.invalid';
const ANONYMOUS_NAME = 'Utilisateur anonymisé';
const ERASED = '[contenu supprimé]';
/** Durée minimale de conservation acceptée pour la purge automatique. */
export const MIN_RETENTION_MONTHS = 6;

interface Actor {
  id: string;
}

export class PrivacyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: FileStorage,
  ) {}

  /** Droit d'accès : toutes les données rattachées à une personne, au format JSON. */
  async export(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    });
    if (!user) throw notFound('Utilisateur introuvable');
    const [tickets, comments, meetings, inbound] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { requesterId: id },
        select: { id: true, subject: true, description: true, status: true, channel: true, createdAt: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.comment.findMany({
        where: { authorId: id },
        select: { ticketId: true, body: true, isInternal: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.meetingAttendee.count({ where: { userId: id } }),
      this.prisma.inboundEmail.findMany({
        where: { fromAddress: user.email },
        select: { subject: true, receivedAt: true, status: true },
        orderBy: { receivedAt: 'asc' },
      }),
    ]);
    return { exportedAt: new Date(), user, tickets, comments, meetingCount: meetings, receivedEmails: inbound };
  }

  /**
   * Anonymise une personne : identité effacée, connexion impossible, journaux d'e-mails nettoyés.
   * Les tickets restent (statistiques, historique) ; `eraseContent` efface aussi ses textes et pièces jointes.
   */
  async anonymize(actor: Actor, id: string, eraseContent: boolean) {
    if (actor.id === id) throw badRequest('Vous ne pouvez pas anonymiser votre propre compte');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound('Utilisateur introuvable');
    if (user.email.endsWith(`@${ANONYMOUS_DOMAIN}`)) throw conflict('Cet utilisateur est déjà anonymisé');

    const anonymousEmail = `anonyme-${id}@${ANONYMOUS_DOMAIN}`;
    const rawKeys = (
      await this.prisma.inboundEmail.findMany({ where: { fromAddress: user.email, rawKey: { not: null } }, select: { rawKey: true } })
    ).map((r) => r.rawKey!);
    const fileKeys = eraseContent
      ? (await this.prisma.attachment.findMany({ where: { ticket: { requesterId: id } }, select: { storageKey: true } })).map((a) => a.storageKey)
      : [];

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { email: anonymousEmail, name: ANONYMOUS_NAME, passwordHash: null, isActive: false } }),
      this.prisma.notification.deleteMany({ where: { userId: id } }),
      this.prisma.inboundEmail.updateMany({ where: { fromAddress: user.email }, data: { fromAddress: anonymousEmail, subject: ERASED, rawKey: null } }),
      this.prisma.outboundEmail.updateMany({ where: { toAddress: user.email }, data: { toAddress: anonymousEmail, subject: ERASED, body: ERASED } }),
      ...(eraseContent
        ? [
            this.prisma.comment.updateMany({ where: { authorId: id }, data: { body: ERASED } }),
            this.prisma.ticket.updateMany({ where: { requesterId: id }, data: { description: ERASED } }),
            this.prisma.attachment.deleteMany({ where: { ticket: { requesterId: id } } }),
          ]
        : []),
      // Aucune donnée personnelle dans le journal : l'identifiant suffit.
      this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'privacy.user_anonymized', changes: { userId: id, eraseContent } } }),
    ]);
    // Les fichiers sont supprimés après la validation en base : un échec laisse au pire un fichier orphelin.
    await Promise.allSettled([...rawKeys, ...fileKeys].map((k) => this.storage.delete(k)));
  }

  /**
   * Purge de conservation : anonymise les utilisateurs externes dont tous les tickets sont clos depuis
   * plus de `months` mois (ou sans ticket et créés avant cette date). `dryRun` ne modifie rien.
   */
  async purge(actor: Actor, months: number, dryRun: boolean) {
    if (months < MIN_RETENTION_MONTHS) throw badRequest(`Conservation minimale : ${MIN_RETENTION_MONTHS} mois`);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const candidates = await this.prisma.user.findMany({
      where: {
        role: 'EXTERNAL_USER',
        email: { not: { endsWith: `@${ANONYMOUS_DOMAIN}` } },
        createdAt: { lt: cutoff },
        requestedTickets: { none: { OR: [{ status: { not: 'CLOSED' } }, { closedAt: null }, { closedAt: { gte: cutoff } }] } },
      },
      select: { id: true },
    });
    if (!dryRun) {
      for (const { id } of candidates) await this.anonymize(actor, id, false);
      // Les journaux d'e-mails reçus n'ont pas d'utilité au-delà de la durée de conservation.
      const old = await this.prisma.inboundEmail.findMany({ where: { receivedAt: { lt: cutoff } }, select: { id: true, rawKey: true } });
      await this.prisma.inboundEmail.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
      await Promise.allSettled(old.flatMap((o) => (o.rawKey ? [this.storage.delete(o.rawKey)] : [])));
      await this.prisma.auditLog.create({
        data: { actorId: actor.id, action: 'privacy.purge', changes: { months, anonymized: candidates.length, emailLogs: old.length } },
      });
      return { dryRun, cutoff, users: candidates.length, emailLogs: old.length };
    }
    const emailLogs = await this.prisma.inboundEmail.count({ where: { receivedAt: { lt: cutoff } } });
    return { dryRun, cutoff, users: candidates.length, emailLogs };
  }
}
