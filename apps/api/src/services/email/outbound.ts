import type { Prisma, PrismaClient } from '@prisma/client';
import { renderMacro, SYSTEM_MACRO_KEYS } from '@ticketing/shared';
import { randomUUID } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { REPLY_MARKER, subjectWithTag } from '../../lib/email-text';
import type { AttachmentService } from '../attachments';

type Tx = Prisma.TransactionClient;

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  headers: Record<string, string>;
  attachments: { filename: string; contentType: string; content: Buffer }[];
}

/** Transport d'envoi : SMTP (nodemailer) en production, capture en mémoire dans les tests. */
export interface MailTransport {
  /** Faux si le message n'a pas réellement quitté l'application (aucun SMTP configuré). */
  readonly delivers: boolean;
  send(message: MailMessage): Promise<void>;
}

export interface OutboundDeps {
  prisma: PrismaClient;
  attachments: AttachmentService;
  transport: MailTransport;
  /** Adresse d'envoi à défaut de boîte de réception configurée. */
  defaultFrom: string | null;
  fromName: string;
  /** Domaine des Message-ID générés. */
  domain: string;
  publicAppUrl: string;
}

/** Délais avant nouvel essai après un échec d'envoi ; au-delà, l'e-mail est marqué en échec. */
const RETRY_MINUTES = [1, 5, 15, 60];
const LOCK_KEY = 74_202;

/**
 * Envoi des e-mails par file d'attente : les messages sont enregistrés dans la même
 * transaction que le commentaire, puis envoyés par une tâche périodique avec reprises.
 */
export class OutboundMailer {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly d: OutboundDeps) {}

  private newMessageId() {
    return `<${randomUUID()}@${this.d.domain}>`;
  }

  private footer(ticketId: number) {
    return `\n\n—\nVotre demande : ${this.d.publicAppUrl.replace(/\/$/, '')}/tickets/${ticketId}\nPour répondre, répondez simplement à cet e-mail en conservant le numéro de ticket dans le sujet.`;
  }

  /** Adresse d'expédition : la boîte par laquelle le ticket est arrivé, sinon la première active. */
  private async fromAddress(tx: Tx, mailboxId: string | null): Promise<string | null> {
    const mailbox =
      (mailboxId && (await tx.mailbox.findFirst({ where: { id: mailboxId, isActive: true } }))) ||
      (await tx.mailbox.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }));
    const address = mailbox?.address ?? this.d.defaultFrom;
    return address ? `${this.d.fromName} <${address}>` : null;
  }

  /** Message-ID déjà échangés sur le ticket, du plus ancien au plus récent, pour le fil. */
  private async thread(tx: Tx, ticketId: number) {
    const [inbound, comments] = await Promise.all([
      tx.inboundEmail.findMany({ where: { ticketId, commentId: null, status: 'PROCESSED' }, select: { messageId: true, receivedAt: true } }),
      tx.comment.findMany({ where: { ticketId, messageId: { not: null } }, select: { messageId: true, createdAt: true } }),
    ]);
    const ids = [
      ...inbound.map((m) => ({ id: m.messageId, at: m.receivedAt })),
      ...comments.map((c) => ({ id: c.messageId!, at: c.createdAt })),
    ]
      .sort((a, b) => +a.at - +b.at)
      .map((m) => m.id);
    return { inReplyTo: ids.at(-1), references: ids.slice(-10).join(' ') || undefined };
  }

  /** Programme l'envoi au demandeur d'une réponse publique du support. */
  async enqueueComment(tx: Tx, ticketId: number, commentId: string) {
    const ticket = await tx.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { requester: { select: { id: true, email: true, role: true, isActive: true } } },
    });
    const comment = await tx.comment.findUniqueOrThrow({ where: { id: commentId } });
    if (comment.isInternal || comment.authorId === ticket.requesterId || !ticket.requester.isActive) return;
    const from = await this.fromAddress(tx, ticket.mailboxId);
    if (!from) return;

    const messageId = this.newMessageId();
    const { inReplyTo, references } = await this.thread(tx, ticketId);
    await tx.comment.update({ where: { id: commentId }, data: { messageId } });
    await tx.outboundEmail.create({
      data: {
        ticketId,
        commentId,
        fromAddress: from,
        toAddress: ticket.requester.email,
        subject: subjectWithTag(ticket.id, ticket.subject),
        body: `${REPLY_MARKER}\n\n${comment.body}${this.footer(ticket.id)}`,
        messageId,
        inReplyTo,
        references,
      },
    });
  }

  /** Accusé de réception d'un ticket créé par e-mail (macro système modifiable). */
  async enqueueAcknowledgement(tx: Tx, ticketId: number, inboundMessageId: string) {
    const macro = await tx.macro.findUnique({ where: { systemKey: SYSTEM_MACRO_KEYS.emailAcknowledgement } });
    if (!macro?.isActive) return;
    const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { requester: true } });
    const from = await this.fromAddress(tx, ticket.mailboxId);
    if (!from) return;
    const text = renderMacro(macro.body, {
      ticket,
      requester: ticket.requester,
      agent: { name: this.d.fromName },
      timeZone: 'Europe/Paris',
    });
    await tx.outboundEmail.create({
      data: {
        ticketId,
        fromAddress: from,
        toAddress: ticket.requester.email,
        subject: subjectWithTag(ticket.id, ticket.subject),
        body: `${REPLY_MARKER}\n\n${text}${this.footer(ticket.id)}`,
        messageId: this.newMessageId(),
        inReplyTo: inboundMessageId,
        references: inboundMessageId,
      },
    });
  }

  /** Envoie les e-mails en attente ; une seule instance à la fois grâce au verrou consultatif. */
  async processPending(now = new Date()): Promise<{ sent: number; failed: number }> {
    const due = await this.d.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`;
      if (!lock?.locked) return [];
      const batch = await tx.outboundEmail.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: now } },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      // Réservation : une autre instance ne reprendra ces messages qu'après 5 minutes sans résultat.
      await tx.outboundEmail.updateMany({
        where: { id: { in: batch.map((e) => e.id) } },
        data: { nextAttemptAt: new Date(now.getTime() + 5 * 60_000) },
      });
      return batch;
    });

    let sent = 0;
    let failed = 0;
    for (const email of due) {
      try {
        const files = email.commentId
          ? await this.d.prisma.attachment.findMany({ where: { commentId: email.commentId } })
          : [];
        await this.d.transport.send({
          from: email.fromAddress,
          to: email.toAddress,
          subject: email.subject,
          text: email.body,
          messageId: email.messageId,
          inReplyTo: email.inReplyTo ?? undefined,
          references: email.references ?? undefined,
          // Signale une réponse automatique : évite les boucles avec les répondeurs d'absence.
          headers: { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' },
          attachments: await Promise.all(
            files.map(async (f) => ({
              filename: f.filename,
              contentType: f.contentType,
              content: await buffer(await this.d.attachments.read(f.storageKey)),
            })),
          ),
        });
        await this.d.prisma.outboundEmail.update({
          where: { id: email.id },
          data: this.d.transport.delivers
            ? { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, lastError: null }
            : { status: 'SKIPPED', attempts: { increment: 1 }, lastError: 'SMTP non configuré : e-mail journalisé, non envoyé' },
        });
        sent++;
      } catch (err) {
        const attempts = email.attempts + 1;
        const delay = RETRY_MINUTES[attempts - 1];
        await this.d.prisma.outboundEmail.update({
          where: { id: email.id },
          data: {
            attempts,
            lastError: err instanceof Error ? err.message.slice(0, 500) : String(err),
            ...(delay === undefined
              ? { status: 'FAILED' }
              : { nextAttemptAt: new Date(now.getTime() + delay * 60_000) }),
          },
        });
        failed++;
      }
    }
    return { sent, failed };
  }

  start(intervalMs: number, onError: (err: unknown) => void) {
    const tick = () => void this.processPending().catch(onError);
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
