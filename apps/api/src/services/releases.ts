import type { Prisma, PrismaClient } from '@prisma/client';
import { compileNotes, defaultReleaseCategory, type ReleaseCategory } from '@ticketing/shared';
import { badRequest, conflict, notFound } from '../lib/errors';
import type { OutboundMailer } from './email/outbound';

export interface ReleaseDeps {
  prisma: PrismaClient;
  mailer: OutboundMailer;
  publicAppUrl: string;
}

interface Actor {
  id: string;
}

const itemInclude = {
  ticket: {
    select: {
      id: true,
      subject: true,
      type: true,
      component: true,
      status: true,
      devLinks: { select: { externalKey: true, url: true, fixVersion: true } },
    },
  },
} satisfies Prisma.ReleaseItemInclude;

/** Statuts d'un ticket pouvant entrer dans une version : prêt à livrer ou déjà livré. */
const DELIVERABLE = ['READY_FOR_RELEASE', 'RESOLVED'] as const;

export class ReleaseService {
  constructor(private readonly d: ReleaseDeps) {}

  list() {
    return this.d.prisma.release.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
  }

  async get(id: string) {
    const release = await this.d.prisma.release.findUnique({
      where: { id },
      include: { items: { include: itemInclude, orderBy: { ticketId: 'asc' } } },
    });
    if (!release) throw notFound('Version introuvable');
    return { ...release, notes: this.notes(release.items) };
  }

  private notes(items: { ticketId: number; category: ReleaseCategory; summary: string | null; ticket: { subject: string; component: string | null } }[]) {
    return compileNotes(
      items.map((i) => ({ ticketId: i.ticketId, category: i.category, summary: i.summary, subject: i.ticket.subject, component: i.ticket.component })),
    );
  }

  async create(actor: Actor, input: { version: string; title?: string | null }) {
    if (await this.d.prisma.release.findUnique({ where: { version: input.version } })) throw conflict('Cette version existe déjà');
    const release = await this.d.prisma.release.create({ data: { version: input.version, title: input.title ?? null } });
    await this.audit(actor, 'release.created', release.id, { version: release.version });
    return this.get(release.id);
  }

  /** Tickets prêts à livrer qui ne figurent dans aucune version ; ceux dont la version de correction Jira/GitHub correspond sont signalés. */
  async candidates(id: string) {
    const release = await this.d.prisma.release.findUnique({ where: { id } });
    if (!release) throw notFound('Version introuvable');
    const tickets = await this.d.prisma.ticket.findMany({
      where: { status: { in: [...DELIVERABLE] }, releaseItems: { none: {} } },
      orderBy: { id: 'desc' },
      take: 200,
      select: { id: true, subject: true, type: true, status: true, devLinks: { select: { fixVersion: true } } },
    });
    return tickets.map(({ devLinks, ...t }) => ({ ...t, matchesVersion: devLinks.some((l) => l.fixVersion === release.version) }));
  }

  private async editable(id: string) {
    const release = await this.d.prisma.release.findUnique({ where: { id } });
    if (!release) throw notFound('Version introuvable');
    if (release.status === 'PUBLISHED') throw conflict('Cette version est publiée : ses notes ne se modifient plus');
    return release;
  }

  async addTickets(actor: Actor, id: string, ticketIds: number[]) {
    await this.editable(id);
    const tickets = await this.d.prisma.ticket.findMany({
      where: { id: { in: ticketIds } },
      select: { id: true, type: true, status: true, releaseItems: { select: { releaseId: true } } },
    });
    if (tickets.length !== new Set(ticketIds).size) throw badRequest('Ticket introuvable');
    for (const t of tickets) {
      if (!(DELIVERABLE as readonly string[]).includes(t.status)) throw conflict(`Le ticket #${t.id} n'est pas prêt à livrer`);
      if (t.releaseItems.some((r) => r.releaseId !== id)) throw conflict(`Le ticket #${t.id} figure déjà dans une autre version`);
    }
    await this.d.prisma.releaseItem.createMany({
      data: tickets.map((t) => ({ releaseId: id, ticketId: t.id, category: defaultReleaseCategory(t.type) })),
      skipDuplicates: true,
    });
    await this.audit(actor, 'release.tickets_added', id, { ticketIds: tickets.map((t) => t.id) });
    return this.get(id);
  }

  async updateItem(actor: Actor, id: string, ticketId: number, input: { category?: ReleaseCategory; summary?: string | null }) {
    await this.editable(id);
    const item = await this.d.prisma.releaseItem.findUnique({ where: { releaseId_ticketId: { releaseId: id, ticketId } } });
    if (!item) throw notFound('Ticket absent de cette version');
    await this.d.prisma.releaseItem.update({ where: { releaseId_ticketId: { releaseId: id, ticketId } }, data: input });
    // Le résumé n'est pas recopié dans le journal.
    await this.audit(actor, 'release.item_updated', id, { ticketId });
    return this.get(id);
  }

  async removeTicket(actor: Actor, id: string, ticketId: number) {
    await this.editable(id);
    await this.d.prisma.releaseItem.deleteMany({ where: { releaseId: id, ticketId } });
    await this.audit(actor, 'release.ticket_removed', id, { ticketId });
    return this.get(id);
  }

  async remove(actor: Actor, id: string) {
    const release = await this.editable(id);
    await this.d.prisma.release.delete({ where: { id } });
    await this.audit(actor, 'release.deleted', id, { version: release.version });
  }

  /**
   * Publie la version, puis prévient chaque demandeur des tickets livrés (un e-mail chacun, sans ticket créé).
   * Un échec d'e-mail ne défait pas la publication : il est renvoyé pour permettre de relancer la notification.
   */
  async publish(actor: Actor, id: string, notify: boolean) {
    const release = await this.editable(id);
    const count = await this.d.prisma.releaseItem.count({ where: { releaseId: id } });
    if (count === 0) throw conflict('Ajoutez au moins un ticket avant de publier');
    await this.d.prisma.release.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    await this.audit(actor, 'release.published', id, { version: release.version });
    const result = notify ? await this.notify(actor, id) : null;
    return { release: await this.get(id), notification: result };
  }

  async notify(actor: Actor, id: string) {
    const release = await this.d.prisma.release.findUnique({
      where: { id },
      include: { items: { include: { ticket: { select: { id: true, subject: true, requester: { select: { email: true, name: true, isActive: true } } } } } } },
    });
    if (!release) throw notFound('Version introuvable');
    if (release.status !== 'PUBLISHED') throw conflict("Publiez la version avant de prévenir les demandeurs");
    if (release.notifiedCount !== null) throw conflict('Les demandeurs ont déjà été prévenus');

    const byRequester = new Map<string, { name: string; lines: string[] }>();
    for (const { ticket, summary } of release.items) {
      if (!ticket.requester.isActive) continue;
      const entry = byRequester.get(ticket.requester.email) ?? { name: ticket.requester.name, lines: [] };
      entry.lines.push(`- Demande #${ticket.id} : ${summary?.trim() || ticket.subject}`);
      byRequester.set(ticket.requester.email, entry);
    }
    const url = `${this.d.publicAppUrl.replace(/\/$/, '')}/releases`;
    let sent = 0;
    let failed = 0;
    let delivered = true;
    try {
      for (const [email, { name, lines }] of byRequester) {
        const res = await this.d.mailer.broadcast(
          [email],
          `Version ${release.version} : vos demandes sont livrées`,
          `Bonjour ${name},\n\nLa version ${release.version} est disponible. Elle apporte :\n\n${lines.join('\n')}\n\nToutes les nouveautés : ${url}`,
        );
        sent += res.sent;
        failed += res.failed;
        delivered &&= res.delivered;
      }
    } catch (err) {
      throw conflict(err instanceof Error ? err.message : 'Notification impossible');
    }
    await this.d.prisma.release.update({ where: { id }, data: { notifiedCount: sent } });
    await this.audit(actor, 'release.notified', id, { requesters: byRequester.size, sent, failed });
    return { requesters: byRequester.size, sent, failed, delivered };
  }

  /** Portail public : versions publiées, lecture « clients » uniquement. */
  async publicList() {
    const releases = await this.d.prisma.release.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      take: 50,
      include: { items: { include: { ticket: { select: { subject: true, component: true } } } } },
    });
    return releases.map((r) => ({ id: r.id, version: r.version, title: r.title, publishedAt: r.publishedAt, sections: this.notes(r.items).customer }));
  }

  private audit(actor: Actor, action: string, releaseId: string, changes: object) {
    return this.d.prisma.auditLog.create({ data: { actorId: actor.id, action, changes: { releaseId, ...changes } } });
  }
}
