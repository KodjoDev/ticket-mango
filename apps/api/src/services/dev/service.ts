import type { DevIntegration, Prisma, PrismaClient } from '@prisma/client';
import { hasPermission, normalizeExternalStatus, TICKET_STATUSES, type TicketStatus } from '@ticketing/shared';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import type { SecretBox } from '../../lib/secrets';
import type { CurrentUser } from '../../plugins/auth';
import type { TicketService } from '../tickets';
import { buildClient, type ExternalIssue, type HttpFetch, type IssueClient } from './providers';

export interface DevDeps {
  prisma: PrismaClient;
  tickets: TicketService;
  secrets: SecretBox;
  publicAppUrl: string;
  fetcher: HttpFetch;
}

const isTicketStatus = (v: unknown): v is TicketStatus => TICKET_STATUSES.includes(v as TicketStatus);

/** Table de correspondance sûre : les valeurs inconnues (base modifiée à la main) sont ignorées. */
export function readStatusMap(json: Prisma.JsonValue): Record<string, TicketStatus> {
  const map: Record<string, TicketStatus> = {};
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    for (const [key, value] of Object.entries(json)) if (isTicketStatus(value)) map[normalizeExternalStatus(key)] = value;
  }
  return map;
}

/** Lien entre un ticket et une issue Jira / GitHub, et synchronisation des statuts (outil → ticket). */
export class DevService {
  constructor(private readonly d: DevDeps) {}

  private get prisma() {
    return this.d.prisma;
  }

  /** Intégrations utilisables depuis un ticket (sans secret). */
  listActive() {
    return this.prisma.devIntegration.findMany({
      where: { isActive: true },
      select: { id: true, name: true, provider: true, project: true },
      orderBy: { name: 'asc' },
    });
  }

  private client(integration: DevIntegration): IssueClient {
    if (integration.provider === 'JIRA' && !integration.baseUrl) {
      throw conflict(`L'intégration « ${integration.name} » n'a pas d'adresse de site Jira`);
    }
    if (!integration.tokenEnc) throw conflict(`L'intégration « ${integration.name} » n'a pas de jeton d'API`);
    return buildClient(
      {
        provider: integration.provider,
        baseUrl: integration.baseUrl,
        account: integration.account,
        token: this.d.secrets.decrypt(integration.tokenEnc),
        project: integration.project,
        issueType: integration.issueType,
        statusMap: readStatusMap(integration.statusMap),
      },
      this.d.fetcher,
    );
  }

  private async integration(id: string) {
    const integration = await this.prisma.devIntegration.findUnique({ where: { id } });
    if (!integration || !integration.isActive) throw badRequest('Intégration introuvable ou désactivée');
    return integration;
  }

  /** Crée l'issue dans l'outil (sans `reference`) ou lie une issue existante, puis synchronise le ticket. */
  async link(user: CurrentUser, ticketId: number, integrationId: string, reference?: string) {
    if (!hasPermission(user.role, 'ticket:qualify')) throw forbidden();
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw notFound('Ticket introuvable');
    if (ticket.status === 'CLOSED') throw conflict('Un ticket clôturé ne peut plus être modifié');
    const integration = await this.integration(integrationId);
    const client = this.client(integration);

    const issue = reference
      ? await client.getIssue(reference)
      : await client.createIssue({
          title: `[TICKET #${ticket.id}] ${ticket.subject}`,
          body: `${ticket.description}\n\n—\nTicket #${ticket.id} (${ticket.priority}) : ${this.d.publicAppUrl.replace(/\/$/, '')}/tickets/${ticket.id}`,
        });

    const existing = await this.prisma.devLink.findFirst({
      where: { ticketId, integrationId, externalKey: issue.key },
    });
    if (existing) throw conflict(`L'issue ${issue.key} est déjà liée à ce ticket`);

    await this.prisma.$transaction(async (tx) => {
      await tx.devLink.create({
        data: {
          ticketId,
          integrationId,
          externalKey: issue.key,
          url: issue.url,
          title: issue.title.slice(0, 500),
          externalStatus: issue.status,
          fixVersion: issue.fixVersion,
          syncedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          ticketId,
          actorId: user.id,
          action: 'ticket.dev_linked',
          changes: { provider: integration.provider, externalKey: issue.key, created: !reference },
        },
      });
    });
    await this.syncTicket(ticketId, integration, issue.status);
    return { externalKey: issue.key, url: issue.url };
  }

  async unlink(user: CurrentUser, ticketId: number, linkId: string) {
    if (!hasPermission(user.role, 'ticket:qualify')) throw forbidden();
    const link = await this.prisma.devLink.findFirst({ where: { id: linkId, ticketId }, include: { integration: true } });
    if (!link) throw notFound('Lien introuvable');
    await this.prisma.$transaction(async (tx) => {
      await tx.devLink.delete({ where: { id: linkId } });
      await tx.auditLog.create({
        data: {
          ticketId,
          actorId: user.id,
          action: 'ticket.dev_unlinked',
          changes: { provider: link.integration.provider, externalKey: link.externalKey },
        },
      });
    });
    await this.refreshFixVersion(ticketId);
  }

  /** Événement reçu d'un webhook : met à jour les liens de l'issue et les tickets concernés. */
  async applyEvent(integration: DevIntegration, issue: ExternalIssue) {
    const links = await this.prisma.devLink.findMany({
      where: { integrationId: integration.id, externalKey: issue.key },
      select: { id: true, ticketId: true, externalStatus: true, fixVersion: true },
    });
    for (const link of links) {
      await this.prisma.devLink.update({
        where: { id: link.id },
        data: { title: issue.title.slice(0, 500), externalStatus: issue.status, fixVersion: issue.fixVersion, syncedAt: new Date() },
      });
      if (link.externalStatus !== issue.status || link.fixVersion !== issue.fixVersion) {
        await this.prisma.auditLog.create({
          data: {
            ticketId: link.ticketId,
            actorId: null,
            action: 'ticket.dev_synced',
            changes: {
              provider: integration.provider,
              externalKey: issue.key,
              ...(link.externalStatus !== issue.status && { externalStatus: { from: link.externalStatus, to: issue.status } }),
              ...(link.fixVersion !== issue.fixVersion && { fixVersion: { from: link.fixVersion, to: issue.fixVersion } }),
            },
          },
        });
      }
      await this.syncTicket(link.ticketId, integration, issue.status);
    }
    return links.length;
  }

  /** Applique au ticket le statut mappé et la version de correction des issues liées. */
  private async syncTicket(ticketId: number, integration: DevIntegration, externalStatus: string) {
    const target = readStatusMap(integration.statusMap)[normalizeExternalStatus(externalStatus)];
    if (target) await this.d.tickets.advanceFromDev(ticketId, target);
    await this.refreshFixVersion(ticketId);
  }

  /** Version de correction du ticket : celle de l'issue liée la plus récemment synchronisée qui en porte une. */
  private async refreshFixVersion(ticketId: number) {
    const link = await this.prisma.devLink.findFirst({
      where: { ticketId, fixVersion: { not: null } },
      orderBy: { syncedAt: { sort: 'desc', nulls: 'last' } },
      select: { fixVersion: true },
    });
    const version = link?.fixVersion ?? null;
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId }, select: { fixedInVersion: true } });
    if (ticket && ticket.fixedInVersion !== version) {
      await this.prisma.ticket.update({ where: { id: ticketId }, data: { fixedInVersion: version } });
      await this.prisma.auditLog.create({
        data: { ticketId, actorId: null, action: 'ticket.updated', changes: { fixedInVersion: { from: ticket.fixedInVersion, to: version } } },
      });
    }
  }
}
