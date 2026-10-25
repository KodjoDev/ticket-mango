import { Prisma, type InboundStatus, type PrismaClient, type User } from '@prisma/client';
import { hasPermission } from '@ticketing/shared';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { createHash, randomUUID } from 'node:crypto';
import { htmlToText, normalizeSubject, stripQuotedReply, ticketTag } from '../../lib/email-text';
import type { CurrentUser } from '../../plugins/auth';
import type { IncomingFile } from '../attachments';
import type { ConfigService } from '../config';
import type { FileStorage } from '../storage';
import type { TicketService } from '../tickets';
import { autoReplyReason, bulkReason, spamReason, type Headers } from './detect';
import type { OutboundMailer } from './outbound';

/** Taille maximale d'un e-mail brut accepté (pièces jointes de 25 Mo encodées en base64 comprises). */
export const MAX_RAW_EMAIL_BYTES = 40 * 1024 * 1024;
/** Les petites images intégrées (logos de signature) ne sont pas conservées comme pièces jointes. */
const INLINE_IMAGE_SKIP_BYTES = 20 * 1024;
const MAX_BODY = 50_000;

export interface EmailSettings {
  /** Envoyer un accusé de réception à la création d'un ticket par e-mail. */
  acknowledge: boolean;
  /** Adresses (claire@x.fr) ou domaines (@x.fr) dont les messages sont traités comme spam. */
  blocklist: string[];
  /** Au-delà, les messages d'un même expéditeur sont considérés comme une boucle. */
  maxPerSenderPerHour: number;
  /** Écarter les newsletters et notifications de services (en-têtes de liste de diffusion). */
  ignoreBulk: boolean;
}

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = { acknowledge: true, blocklist: [], maxPerSenderPerHour: 20, ignoreBulk: true };

export interface InboundResult {
  status: InboundStatus;
  reason?: string;
  ticketId?: number;
  commentId?: string;
}

export interface InboundDeps {
  prisma: PrismaClient;
  tickets: TicketService;
  mailer: OutboundMailer;
  config: ConfigService;
  storage: FileStorage;
}

const asCurrentUser = (u: User): CurrentUser => ({ id: u.id, email: u.email, name: u.name, role: u.role });

function headerMap(parsed: ParsedMail): Headers {
  const map: Headers = new Map();
  for (const { key, line } of parsed.headerLines) {
    const value = line.slice(line.indexOf(':') + 1).trim();
    map.set(key.toLowerCase(), map.has(key.toLowerCase()) ? `${map.get(key.toLowerCase())}, ${value}` : value);
  }
  return map;
}

function firstAddress(field: AddressObject | AddressObject[] | undefined) {
  const list = Array.isArray(field) ? field : field ? [field] : [];
  const entry = list.flatMap((a) => a.value).find((v) => v.address);
  return entry ? { address: entry.address!.trim().toLowerCase(), name: entry.name?.trim() || '' } : null;
}

/** Nom d'un contact créé depuis un e-mail : nom affiché, sinon partie locale de l'adresse. */
function contactName(address: string, display: string): string {
  if (display && !display.includes('@')) return display.slice(0, 200);
  return (address.split('@')[0] ?? address).replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Réception d'un e-mail (IMAP ou webhook) : déduplication par Message-ID, filtrage
 * (boucles, réponses automatiques, spam), puis rattachement au fil existant ou création
 * d'un ticket. Chaque message reçu laisse une ligne dans le journal InboundEmail.
 */
export class InboundService {
  constructor(private readonly d: InboundDeps) {}

  async settings(): Promise<EmailSettings> {
    const saved = (await this.d.prisma.setting.findUnique({ where: { key: 'emailSettings' } }))?.value;
    return { ...DEFAULT_EMAIL_SETTINGS, ...(saved && typeof saved === 'object' ? (saved as Partial<EmailSettings>) : {}) };
  }

  async process(raw: Buffer, mailboxId: string | null): Promise<InboundResult> {
    if (raw.length > MAX_RAW_EMAIL_BYTES) {
      return { status: 'ERROR', reason: `E-mail trop volumineux (${Math.round(raw.length / 1024 / 1024)} Mo)` };
    }
    let parsed: ParsedMail;
    try {
      parsed = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
    } catch {
      return this.record(raw, mailboxId, fallbackId(raw), '?', '?', 'ERROR', 'E-mail illisible');
    }
    const messageId = parsed.messageId?.trim() || fallbackId(raw);
    const from = firstAddress(parsed.from);
    const subject = (parsed.subject ?? '').slice(0, 500);

    // Le Message-ID est réservé d'emblée : un même e-mail reçu deux fois (IMAP + webhook) n'est traité qu'une fois.
    let logId: string;
    try {
      logId = (
        await this.d.prisma.inboundEmail.create({
          data: { mailboxId, messageId, fromAddress: from?.address ?? '?', subject, status: 'ERROR', reason: 'En cours de traitement', size: raw.length },
        })
      ).id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { status: 'DUPLICATE' };
      throw err;
    }

    try {
      const result = await this.handle(parsed, messageId, from, subject, mailboxId);
      await this.d.prisma.inboundEmail.update({
        where: { id: logId },
        data: { status: result.status, reason: result.reason ?? null, ticketId: result.ticketId, commentId: result.commentId },
      });
      // Message écarté : conservé brut pour pouvoir le relire ou le retraiter.
      if (result.status === 'SPAM' || result.status === 'BULK') await this.keepRaw(logId, raw);
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 500) : String(err);
      await this.d.prisma.inboundEmail.update({ where: { id: logId }, data: { status: 'ERROR', reason } });
      await this.keepRaw(logId, raw);
      return { status: 'ERROR', reason };
    }
  }

  private async keepRaw(logId: string, raw: Buffer) {
    const key = `inbound/${logId}.eml`;
    await this.d.storage.put(key, raw).catch(() => undefined);
    await this.d.prisma.inboundEmail.update({ where: { id: logId }, data: { rawKey: key } });
  }

  private async record(raw: Buffer, mailboxId: string | null, messageId: string, from: string, subject: string, status: InboundStatus, reason: string): Promise<InboundResult> {
    const log = await this.d.prisma.inboundEmail
      .create({ data: { mailboxId, messageId, fromAddress: from, subject, status, reason, size: raw.length } })
      .catch(() => null);
    if (log && status === 'ERROR') await this.keepRaw(log.id, raw);
    return { status, reason };
  }

  /** Retraite un e-mail en erreur ou écarté à tort (son entrée de journal est remplacée). */
  async retry(logId: string): Promise<InboundResult> {
    const log = await this.d.prisma.inboundEmail.findUniqueOrThrow({ where: { id: logId } });
    if (!log.rawKey) throw new Error('Le message brut n’a pas été conservé');
    const { buffer } = await import('node:stream/consumers');
    const raw = await buffer(await this.d.storage.get(log.rawKey));
    await this.d.prisma.inboundEmail.delete({ where: { id: logId } });
    return this.process(raw, log.mailboxId);
  }

  private async handle(
    parsed: ParsedMail,
    messageId: string,
    from: { address: string; name: string } | null,
    subject: string,
    mailboxId: string | null,
  ): Promise<InboundResult> {
    if (!from) return { status: 'ERROR', reason: 'Expéditeur absent' };
    const headers = headerMap(parsed);
    const settings = await this.settings();

    // Boucles : message venant de nos propres adresses, ou rafale d'un même expéditeur.
    if (await this.d.prisma.mailbox.findUnique({ where: { address: from.address } })) {
      return { status: 'LOOP', reason: 'Expéditeur = une boîte de réception de l’outil' };
    }
    const recent = await this.d.prisma.inboundEmail.count({
      where: { fromAddress: from.address, receivedAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (recent > settings.maxPerSenderPerHour) {
      return { status: 'LOOP', reason: `Plus de ${settings.maxPerSenderPerHour} messages en une heure` };
    }
    const auto = autoReplyReason(headers, from.address, subject);
    if (auto) return { status: 'AUTO_REPLY', reason: auto };
    const bulk = settings.ignoreBulk ? bulkReason(headers) : null;
    if (bulk) return { status: 'BULK', reason: bulk };
    const spam = spamReason(headers, from.address, settings.blocklist);
    if (spam) return { status: 'SPAM', reason: spam };

    const sender = await this.findOrCreateContact(from.address, from.name);
    if (!sender.isActive) return { status: 'SPAM', reason: 'Compte de l’expéditeur désactivé' };

    const text = (parsed.text?.trim() || (parsed.html ? htmlToText(parsed.html) : '')).slice(0, MAX_BODY);
    const files = this.files(parsed);
    const thread = await this.findThread(parsed, subject, sender);

    if (thread && thread.status !== 'CLOSED') {
      const comment = await this.d.tickets.addComment(asCurrentUser(sender), thread.id, stripQuotedReply(text) || '(message vide)', false, {
        channel: 'EMAIL',
        messageId,
        files,
      });
      return { status: 'PROCESSED', ticketId: thread.id, commentId: comment.id };
    }

    const mailbox = mailboxId ? await this.d.prisma.mailbox.findUnique({ where: { id: mailboxId } }) : null;
    const type = mailbox?.defaultType
      ? (await this.d.prisma.fieldOption.findFirst({ where: { field: 'TYPE', key: mailbox.defaultType, isActive: true } }))?.key
      : undefined;
    const ticket = await this.d.tickets.create(
      asCurrentUser(sender),
      { subject: normalizeSubject(subject).slice(0, 250), description: text || '(message vide)', type },
      {
        channel: 'EMAIL',
        mailboxId,
        groupId: mailbox?.defaultGroupId ?? undefined,
        // Réponse à un ticket clôturé : nouveau ticket qui y renvoie.
        descriptionPrefix: thread ? `Suite du ticket #${thread.id} (clôturé).` : undefined,
      },
    );
    await this.d.prisma.$transaction(async (tx) => {
      for (const file of files) await this.d.tickets.saveAttachment(tx, ticket.id, file, sender.id);
      if (settings.acknowledge && !hasPermission(sender.role, 'ticket:qualify')) {
        await this.d.mailer.enqueueAcknowledgement(tx, ticket.id, messageId);
      }
    });
    return { status: 'PROCESSED', ticketId: ticket.id };
  }

  private files(parsed: ParsedMail): IncomingFile[] {
    return parsed.attachments
      .filter((a) => !(a.related && a.contentType.startsWith('image/') && a.size < INLINE_IMAGE_SKIP_BYTES))
      .map((a, i) => ({
        filename: a.filename || `piece-jointe-${i + 1}`,
        contentType: a.contentType || 'application/octet-stream',
        data: a.content,
      }));
  }

  private async findOrCreateContact(address: string, display: string): Promise<User> {
    const existing = await this.d.prisma.user.findUnique({ where: { email: address } });
    if (existing) return existing;
    try {
      return await this.d.prisma.user.create({
        data: { email: address, name: contactName(address, display), role: 'EXTERNAL_USER', passwordHash: null },
      });
    } catch (err) {
      // Création simultanée par un autre traitement : on relit.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.d.prisma.user.findUniqueOrThrow({ where: { email: address } });
      }
      throw err;
    }
  }

  /**
   * Ticket auquel rattacher la réponse : d'abord par les en-têtes de fil (In-Reply-To,
   * References), sinon par le repère [TICKET #n] du sujet. Seuls le demandeur et le
   * support peuvent écrire dans un ticket existant ; un tiers ouvre un nouveau ticket.
   */
  private async findThread(parsed: ParsedMail, subject: string, sender: User) {
    const refs = [
      ...(parsed.inReplyTo ? [parsed.inReplyTo] : []),
      ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : []),
    ]
      .map((r) => r.trim())
      .filter(Boolean)
      .slice(-50);

    let ticketId: number | null = null;
    if (refs.length) {
      const [comment, inbound, outbound] = await Promise.all([
        this.d.prisma.comment.findFirst({ where: { messageId: { in: refs } }, select: { ticketId: true } }),
        this.d.prisma.inboundEmail.findFirst({ where: { messageId: { in: refs }, ticketId: { not: null } }, select: { ticketId: true } }),
        this.d.prisma.outboundEmail.findFirst({ where: { messageId: { in: refs } }, select: { ticketId: true } }),
      ]);
      ticketId = comment?.ticketId ?? inbound?.ticketId ?? outbound?.ticketId ?? null;
    }
    ticketId ??= ticketTag(subject);
    if (ticketId === null) return null;

    // Suit les fusions : un doublon fusionné renvoie vers le ticket conservé.
    let ticket = await this.d.prisma.ticket.findUnique({ where: { id: ticketId } });
    for (let i = 0; ticket?.mergedIntoId && i < 5; i++) {
      ticket = await this.d.prisma.ticket.findUnique({ where: { id: ticket.mergedIntoId } });
    }
    if (!ticket) return null;
    const allowed = ticket.requesterId === sender.id || hasPermission(sender.role, 'ticket:qualify');
    return allowed ? ticket : null;
  }
}

/** Identifiant de repli pour un e-mail sans Message-ID : empreinte du contenu brut. */
function fallbackId(raw: Buffer): string {
  return `<sha256-${createHash('sha256').update(raw).digest('hex')}@sans-message-id>`;
}

export const newWebhookToken = () => randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
