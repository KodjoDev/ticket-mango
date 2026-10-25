import type { Prisma, PrismaClient, Ticket } from '@prisma/client';
import {
  canTransition,
  computePriority,
  hasPermission,
  type Component,
  type Environment,
  type Impact,
  type Permission,
  type Priority,
  type TicketStatus,
  type TicketType,
  type Urgency,
} from '@ticketing/shared';
import { diff } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import type { CurrentUser } from '../plugins/auth';

export const ticketInclude = {
  requester: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.TicketInclude;

export interface CreateTicketInput {
  subject: string;
  description: string;
  type?: TicketType;
  component?: Component | null;
  environment?: Environment | null;
  impact?: Impact;
  urgency?: Urgency;
  priority?: Priority;
  requesterId?: string;
  assigneeId?: string | null;
}

export interface UpdateTicketInput {
  subject?: string;
  description?: string;
  type?: TicketType;
  component?: Component | null;
  environment?: Environment | null;
  impact?: Impact;
  urgency?: Urgency;
  /** `null` annule le forçage et revient à la priorité calculée par la matrice. */
  priority?: Priority | null;
  assigneeId?: string | null;
}

export interface ListTicketsFilters {
  status?: TicketStatus[];
  priority?: Priority[];
  type?: TicketType;
  component?: Component;
  assigneeId?: string;
  q?: string;
  page: number;
  pageSize: number;
}

const QUALIFICATION_FIELDS = ['type', 'component', 'environment', 'impact', 'urgency'] as const;

/** Rôles qui interviennent sur les tickets pour le compte du support. */
export const isStaff = (user: CurrentUser) => hasPermission(user.role, 'ticket:qualify');

function ensure(user: CurrentUser, permission: Permission) {
  if (!hasPermission(user.role, permission)) throw forbidden();
}

export class TicketService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Les utilisateurs sans `ticket:read:all` ne voient que leurs propres tickets ; les autres renvoient 404. */
  private visibilityFilter(user: CurrentUser): Prisma.TicketWhereInput {
    return hasPermission(user.role, 'ticket:read:all') ? {} : { requesterId: user.id };
  }

  async getVisible(user: CurrentUser, id: number) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, ...this.visibilityFilter(user) },
      include: ticketInclude,
    });
    if (!ticket) throw notFound('Ticket introuvable');
    return ticket;
  }

  async list(user: CurrentUser, f: ListTicketsFilters) {
    const where: Prisma.TicketWhereInput = {
      ...this.visibilityFilter(user),
      ...(f.status && { status: { in: f.status } }),
      ...(f.priority && { priority: { in: f.priority } }),
      ...(f.type && { type: f.type }),
      ...(f.component && { component: f.component }),
      ...(f.assigneeId && { assigneeId: f.assigneeId }),
      ...(f.q && {
        OR: [
          { subject: { contains: f.q, mode: 'insensitive' } },
          { description: { contains: f.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        include: ticketInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return { items, total, page: f.page, pageSize: f.pageSize };
  }

  async create(user: CurrentUser, input: CreateTicketInput) {
    if (input.priority !== undefined) ensure(user, 'ticket:priority:override');
    if (input.assigneeId) {
      ensure(user, 'ticket:assign');
      await this.assertAssignable(input.assigneeId);
    }
    if (input.requesterId && input.requesterId !== user.id) {
      ensure(user, 'ticket:qualify');
      const requester = await this.prisma.user.findUnique({ where: { id: input.requesterId } });
      if (!requester) throw badRequest('Demandeur introuvable');
    }

    const impact = input.impact ?? 'INDIVIDUAL';
    const urgency = input.urgency ?? 'MEDIUM';
    const data = {
      subject: input.subject,
      description: input.description,
      type: input.type ?? 'QUESTION',
      component: input.component ?? null,
      environment: input.environment ?? null,
      impact,
      urgency,
      priority: input.priority ?? computePriority(impact, urgency),
      priorityOverridden: input.priority !== undefined,
      requesterId: input.requesterId ?? user.id,
      assigneeId: input.assigneeId ?? null,
    };

    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({ data, include: ticketInclude });
      const { description: _description, ...snapshot } = data;
      await tx.auditLog.create({
        data: { ticketId: ticket.id, actorId: user.id, action: 'ticket.created', changes: snapshot },
      });
      return ticket;
    });
  }

  async update(user: CurrentUser, id: number, input: UpdateTicketInput) {
    const current = await this.getVisible(user, id);

    if (QUALIFICATION_FIELDS.some((f) => input[f] !== undefined) || input.subject !== undefined || input.description !== undefined) {
      ensure(user, 'ticket:qualify');
    }
    if (input.priority !== undefined) ensure(user, 'ticket:priority:override');
    if (input.assigneeId !== undefined) {
      ensure(user, 'ticket:assign');
      if (input.assigneeId) await this.assertAssignable(input.assigneeId);
    }
    if (current.status === 'CLOSED') throw conflict('Un ticket clôturé ne peut plus être modifié');

    const { priority: priorityInput, ...fields } = input;
    const next: Partial<Ticket> = { ...fields };
    const impact = input.impact ?? current.impact;
    const urgency = input.urgency ?? current.urgency;
    if (priorityInput === null) {
      next.priority = computePriority(impact, urgency);
      next.priorityOverridden = false;
    } else if (priorityInput !== undefined) {
      next.priority = priorityInput;
      next.priorityOverridden = true;
    } else if (!current.priorityOverridden) {
      next.priority = computePriority(impact, urgency);
    }

    const changes = diff(current, next);
    if (Object.keys(changes).length === 0) return current;
    // La description peut être longue et contenir des données personnelles : on ne journalise que le fait qu'elle a changé.
    if (changes.description) changes.description = { from: '[modifié]', to: '[modifié]' };

    return this.prisma.$transaction(async (tx) => {
      // Verrou optimiste : échoue si le ticket a été modifié depuis sa lecture.
      const { count } = await tx.ticket.updateMany({
        where: { id, updatedAt: current.updatedAt },
        data: next,
      });
      if (count === 0) throw conflict('Le ticket a été modifié entre-temps, veuillez recharger');
      await tx.auditLog.create({ data: { ticketId: id, actorId: user.id, action: 'ticket.updated', changes: changes as Prisma.InputJsonObject } });
      return tx.ticket.findUniqueOrThrow({ where: { id }, include: ticketInclude });
    });
  }

  async transition(user: CurrentUser, id: number, to: TicketStatus) {
    ensure(user, 'ticket:transition');
    const current = await this.getVisible(user, id);
    if (!canTransition(current.status, to)) {
      throw conflict(`Transition interdite : ${current.status} → ${to}`);
    }

    const now = new Date();
    const data: Prisma.TicketUpdateManyMutationInput = { status: to };
    if (to === 'RESOLVED') data.resolvedAt = now;
    if (to === 'CLOSED') data.closedAt = now;
    // Réouverture : la résolution précédente n'est plus valable.
    if (current.status === 'RESOLVED' && to === 'QUALIFYING') data.resolvedAt = null;

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.ticket.updateMany({ where: { id, status: current.status }, data });
      if (count === 0) throw conflict('Le statut a été modifié entre-temps, veuillez recharger');
      await tx.auditLog.create({
        data: {
          ticketId: id,
          actorId: user.id,
          action: 'ticket.status_changed',
          changes: { status: { from: current.status, to } },
        },
      });
      return tx.ticket.findUniqueOrThrow({ where: { id }, include: ticketInclude });
    });
  }

  async listComments(user: CurrentUser, ticketId: number) {
    await this.getVisible(user, ticketId);
    return this.prisma.comment.findMany({
      where: { ticketId, ...(!hasPermission(user.role, 'comment:internal') && { isInternal: false }) },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addComment(user: CurrentUser, ticketId: number, body: string, isInternal: boolean) {
    ensure(user, 'comment:create');
    if (isInternal) ensure(user, 'comment:internal');
    const ticket = await this.getVisible(user, ticketId);
    if (ticket.status === 'CLOSED') throw conflict('Un ticket clôturé ne peut plus être commenté');

    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: { ticketId, authorId: user.id, body, isInternal },
        include: { author: { select: { id: true, name: true } } },
      });
      // Première réponse (FRT) : premier commentaire public d'un membre du support.
      if (!isInternal && isStaff(user) && !ticket.firstResponseAt) {
        await tx.ticket.updateMany({
          where: { id: ticketId, firstResponseAt: null },
          data: { firstResponseAt: comment.createdAt },
        });
      }
      await tx.auditLog.create({
        data: {
          ticketId,
          actorId: user.id,
          action: 'comment.created',
          changes: { commentId: comment.id, isInternal },
        },
      });
      return comment;
    });
  }

  async auditTrail(user: CurrentUser, ticketId: number) {
    ensure(user, 'audit:read');
    await this.getVisible(user, ticketId);
    return this.prisma.auditLog.findMany({
      where: { ticketId },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async assertAssignable(userId: string) {
    const assignee = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!assignee || !assignee.isActive || !hasPermission(assignee.role, 'ticket:transition')) {
      throw badRequest("L'utilisateur assigné doit être un agent actif");
    }
  }
}
