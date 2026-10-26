import type { Prisma, PrismaClient } from '@prisma/client';
import { INCIDENT_STATUS_LABELS, type IncidentSeverity, type IncidentStatus } from '@ticketing/shared';
import { badRequest, conflict, notFound } from '../../lib/errors';
import type { SecretBox } from '../../lib/secrets';
import type { HttpFetch } from '../dev/providers';
import type { OutboundMailer } from '../email/outbound';
import type { NotificationService } from '../notifications';
import { sendAlert, type AlertEvent } from './alerts';

export interface IncidentDeps {
  prisma: PrismaClient;
  notifications: NotificationService;
  mailer: OutboundMailer;
  secrets: SecretBox;
  fetcher: HttpFetch;
  publicAppUrl: string;
}

export interface IncidentActor {
  id: string;
}

const MAX_BROADCAST = 500;
/** Historique affiché sur la status page publique. */
const PUBLIC_HISTORY_DAYS = 14;

const detailInclude = {
  updates: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, name: true } } } },
  deliveries: { orderBy: { createdAt: 'desc' }, include: { channel: { select: { name: true, kind: true } } } },
  broadcasts: { orderBy: { createdAt: 'desc' } },
  createdBy: { select: { id: true, name: true } },
  ticket: { select: { id: true, subject: true } },
} satisfies Prisma.IncidentInclude;

export class IncidentService {
  constructor(private readonly d: IncidentDeps) {}

  private get statusUrl() {
    return `${this.d.publicAppUrl.replace(/\/$/, '')}/status`;
  }

  async list(onlyActive: boolean) {
    return this.d.prisma.incident.findMany({
      where: onlyActive ? { status: { not: 'RESOLVED' } } : {},
      orderBy: { startedAt: 'desc' },
      take: 100,
      include: { ticket: { select: { id: true, subject: true } } },
    });
  }

  async get(id: string) {
    const incident = await this.d.prisma.incident.findUnique({ where: { id }, include: detailInclude });
    if (!incident) throw notFound('Incident introuvable');
    return incident;
  }

  async open(
    actor: IncidentActor,
    input: { title: string; severity: IncidentSeverity; message: string; ticketId?: number | null },
  ) {
    if (input.ticketId) {
      const ticket = await this.d.prisma.ticket.findUnique({ where: { id: input.ticketId }, select: { id: true } });
      if (!ticket) throw badRequest('Ticket référent introuvable');
    }
    const incident = await this.d.prisma.$transaction(async (tx) => {
      const created = await tx.incident.create({
        data: {
          title: input.title,
          severity: input.severity,
          ticketId: input.ticketId ?? null,
          createdById: actor.id,
          updates: { create: { status: 'INVESTIGATING', message: input.message, authorId: actor.id } },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          ticketId: created.ticketId,
          action: 'incident.opened',
          changes: { incidentId: created.id, severity: created.severity, title: created.title },
        },
      });
      return created;
    });
    await this.notifyStaff(incident.id, `Incident ${incident.severity} : ${incident.title}`);
    await this.alert('opened', incident.id, input.message);
    return this.get(incident.id);
  }

  async postUpdate(actor: IncidentActor, id: string, input: { status: IncidentStatus; message: string }) {
    const incident = await this.d.prisma.incident.findUnique({ where: { id } });
    if (!incident) throw notFound('Incident introuvable');
    if (incident.status === 'RESOLVED') throw conflict('Cet incident est résolu : il ne reçoit plus de mise à jour');
    await this.d.prisma.$transaction(async (tx) => {
      await tx.incidentUpdate.create({ data: { incidentId: id, status: input.status, message: input.message, authorId: actor.id } });
      await tx.incident.update({
        where: { id },
        data: { status: input.status, ...(input.status === 'RESOLVED' && { resolvedAt: new Date() }) },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          ticketId: incident.ticketId,
          action: input.status === 'RESOLVED' ? 'incident.resolved' : 'incident.updated',
          changes: { incidentId: id, status: { from: incident.status, to: input.status } },
        },
      });
    });
    if (input.status !== incident.status) {
      await this.notifyStaff(id, `Incident ${incident.severity} « ${incident.title} » : ${INCIDENT_STATUS_LABELS[input.status]}`);
    }
    await this.alert(input.status === 'RESOLVED' ? 'resolved' : 'updated', id, input.message);
    return this.get(id);
  }

  async savePostMortem(actor: IncidentActor, id: string, pm: { impact: string | null; rootCause: string | null; actions: string | null }) {
    const incident = await this.d.prisma.incident.findUnique({ where: { id }, select: { id: true, ticketId: true } });
    if (!incident) throw notFound('Incident introuvable');
    await this.d.prisma.$transaction([
      this.d.prisma.incident.update({ where: { id }, data: { pmImpact: pm.impact, pmRootCause: pm.rootCause, pmActions: pm.actions } }),
      // Le contenu n'est pas recopié dans le journal : il peut être long et sensible.
      this.d.prisma.auditLog.create({
        data: { actorId: actor.id, ticketId: incident.ticketId, action: 'incident.postmortem_saved', changes: { incidentId: id } },
      }),
    ]);
    return this.get(id);
  }

  /** Diffuse un message aux clients impactés, sans créer de ticket. */
  async broadcast(actor: IncidentActor, id: string, input: { recipients: string[]; subject: string; message: string }) {
    const incident = await this.d.prisma.incident.findUnique({ where: { id } });
    if (!incident) throw notFound('Incident introuvable');
    const recipients = [...new Set(input.recipients.map((r) => r.toLowerCase()))];
    if (recipients.length > MAX_BROADCAST) throw badRequest(`Au plus ${MAX_BROADCAST} destinataires par diffusion`);
    let result;
    try {
      result = await this.d.mailer.broadcast(recipients, input.subject, `${input.message}\n\n—\nÉtat du service : ${this.statusUrl}`);
    } catch (err) {
      throw conflict(err instanceof Error ? err.message : "Diffusion impossible");
    }
    await this.d.prisma.$transaction([
      this.d.prisma.incidentBroadcast.create({
        data: { incidentId: id, subject: input.subject, recipients: recipients.length, ...result },
      }),
      this.d.prisma.auditLog.create({
        data: {
          actorId: actor.id,
          ticketId: incident.ticketId,
          action: 'incident.broadcast',
          changes: { incidentId: id, recipients: recipients.length, sent: result.sent, failed: result.failed },
        },
      }),
    ]);
    return { recipients: recipients.length, ...result };
  }

  /** Vue publique, sans connexion : aucun nom d'agent, ticket ni destinataire. */
  async publicStatus() {
    const since = new Date(Date.now() - PUBLIC_HISTORY_DAYS * 86_400_000);
    const incidents = await this.d.prisma.incident.findMany({
      where: { OR: [{ status: { not: 'RESOLVED' } }, { resolvedAt: { gte: since } }] },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { updates: { orderBy: { createdAt: 'desc' }, select: { status: true, message: true, createdAt: true } } },
    });
    const shape = ({ id, title, severity, status, startedAt, resolvedAt, updates }: (typeof incidents)[number]) => ({
      id,
      title,
      severity,
      status,
      startedAt,
      resolvedAt,
      updates,
    });
    return {
      operational: incidents.every((i) => i.status === 'RESOLVED'),
      active: incidents.filter((i) => i.status !== 'RESOLVED').map(shape),
      recent: incidents.filter((i) => i.status === 'RESOLVED').map(shape),
    };
  }

  private async notifyStaff(incidentId: string, message: string) {
    const staff = await this.d.prisma.user.findMany({
      where: { isActive: true, role: { in: ['AGENT_N1', 'AGENT_N2', 'ADMIN'] } },
      select: { id: true },
    });
    await this.d.notifications.notify(this.d.prisma, staff.map((u) => u.id), { kind: 'incident', message: `${message} (${incidentId.slice(0, 8)})` });
  }

  /** Alerte les destinations actives ; chaque résultat est journalisé, aucune erreur ne remonte. */
  private async alert(event: AlertEvent, incidentId: string, message: string) {
    const [incident, channels] = await Promise.all([
      this.d.prisma.incident.findUniqueOrThrow({ where: { id: incidentId } }),
      this.d.prisma.alertChannel.findMany({ where: { isActive: true } }),
    ]);
    const payload = {
      id: incident.id,
      title: incident.title,
      severity: incident.severity as IncidentSeverity,
      status: incident.status,
      message,
      statusUrl: this.statusUrl,
    };
    const rows = await Promise.all(
      channels.map(async (channel) => {
        try {
          const outcome = await sendAlert(this.d.fetcher, channel.kind, this.d.secrets.decrypt(channel.targetEnc), event, payload);
          return outcome === 'sent' ? { channelId: channel.id, ok: true, error: null } : null;
        } catch (err) {
          return { channelId: channel.id, ok: false, error: err instanceof Error ? err.message.slice(0, 300) : 'Échec' };
        }
      }),
    );
    const data = rows.filter((r) => r !== null).map((r) => ({ ...r, incidentId, event }));
    if (data.length) await this.d.prisma.alertDelivery.createMany({ data });
  }
}
