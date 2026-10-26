import type { Channel, Prisma, PrismaClient, Ticket } from '@prisma/client';
import {
  canTransition,
  computePriority,
  STATUS_TRANSITIONS,
  DEFAULT_TICKET_TYPE,
  hasPermission,
  isOpenStatus,
  isSlaPausedStatus,
  TICKET_STATUSES,
  type CustomValues,
  type Impact,
  type Permission,
  type Priority,
  type SlaPolicy,
  type SlaState,
  type TicketStatus,
  type Urgency,
  type ViewFilters,
} from '@ticketing/shared';
import { diff } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import type { CurrentUser } from '../plugins/auth';
import type { ConfigService } from './config';
import type { NotificationService } from './notifications';
import type { RoutingService } from './routing';
import { attachmentSelect, type AttachmentService, type IncomingFile } from './attachments';
import type { OutboundMailer } from './email/outbound';
import { slaPausesSelect, type SlaService } from './sla';

type Tx = Prisma.TransactionClient;

export const ticketInclude = {
  requester: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true } },
  group: { select: { id: true, name: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
  slaPauses: slaPausesSelect,
  parent: { select: { id: true, subject: true, status: true } },
  mergedInto: { select: { id: true, subject: true } },
  // Pièces jointes de la demande initiale (celles des messages sont rattachées aux commentaires).
  attachments: { where: { commentId: null }, select: attachmentSelect, orderBy: { createdAt: 'asc' } },
  _count: { select: { children: true } },
} satisfies Prisma.TicketInclude;

/** Options réservées aux traitements internes (réception d'e-mails) : elles contournent les permissions. */
export interface SystemCreateOptions {
  channel: Channel;
  mailboxId?: string | null;
  groupId?: string | null;
  /** Texte ajouté en tête de la description (ex. « Suite du ticket #12 »). */
  descriptionPrefix?: string;
}

export interface CommentOptions {
  channel?: Channel;
  /** Message-ID de l'e-mail à l'origine du commentaire. */
  messageId?: string;
  files?: IncomingFile[];
}

const commentInclude = {
  author: { select: { id: true, name: true } },
  attachments: { select: attachmentSelect, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CommentInclude;

type TicketWithRelations = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

export interface CreateTicketInput {
  subject: string;
  description: string;
  type?: string;
  component?: string | null;
  environment?: string | null;
  impact?: Impact;
  urgency?: Urgency;
  priority?: Priority;
  requesterId?: string;
  assigneeId?: string | null;
  /** Sans groupe explicite, les règles de routage le déterminent. */
  groupId?: string | null;
  tagIds?: string[];
  /** Champs personnalisés, par clé. */
  customValues?: Record<string, unknown>;
}

export interface UpdateTicketInput {
  subject?: string;
  description?: string;
  type?: string;
  component?: string | null;
  environment?: string | null;
  impact?: Impact;
  urgency?: Urgency;
  /** `null` annule le forçage et revient à la priorité calculée par la matrice. */
  priority?: Priority | null;
  /** Ticket saisi pour le compte d'un client (téléphone, oral…) : le support corrige le demandeur. */
  requesterId?: string;
  assigneeId?: string | null;
  groupId?: string | null;
  /** Remplace l'ensemble des tags du ticket. */
  tagIds?: string[];
  /** Fusionné avec les valeurs existantes : seuls les champs fournis changent. */
  customValues?: Record<string, unknown>;
}

export interface ListTicketsFilters {
  status?: TicketStatus[];
  priority?: Priority[];
  type?: string;
  component?: string;
  /** Identifiant d'agent, ou « none » pour les tickets non assignés. */
  assigneeId?: string;
  groupIds?: string[];
  slaState?: SlaState[];
  tagId?: string;
  /** Tickets dont le demandeur attend une réponse du support. */
  awaitingAgent?: boolean;
  q?: string;
  /** « sla » : échéance la plus proche d'abord (dépassés en tête). */
  sort?: 'created' | 'sla';
  page: number;
  pageSize: number;
}

type Filters = Omit<ListTicketsFilters, 'page' | 'pageSize'>;

const QUALIFICATION_FIELDS = ['type', 'component', 'environment', 'impact', 'urgency', 'tagIds', 'customValues'] as const;
const OPEN_STATUSES = TICKET_STATUSES.filter(isOpenStatus);

/** Plus court chemin du workflow entre deux statuts ouverts (RESOLVED et CLOSED exclus), sans le point de départ. */
function workflowPath(from: TicketStatus, to: TicketStatus): TicketStatus[] | null {
  const previous = new Map<TicketStatus, TicketStatus>();
  const queue: TicketStatus[] = [from];
  while (queue.length > 0) {
    const status = queue.shift()!;
    if (status === to) {
      const path: TicketStatus[] = [];
      for (let s: TicketStatus = to; s !== from; s = previous.get(s)!) path.unshift(s);
      return path;
    }
    for (const next of STATUS_TRANSITIONS[status]) {
      if (!isOpenStatus(next) || next === from || previous.has(next)) continue;
      previous.set(next, status);
      queue.push(next);
    }
  }
  return null;
}

/** Rôles qui interviennent sur les tickets pour le compte du support. */
export const isStaff = (user: CurrentUser) => hasPermission(user.role, 'ticket:qualify');

function ensure(user: CurrentUser, permission: Permission) {
  if (!hasPermission(user.role, permission)) throw forbidden();
}

/** Traduit les filtres d'une vue enregistrée en filtres de liste pour l'utilisateur courant. */
export function viewToFilters(user: CurrentUser, f: ViewFilters, userGroupIds: string[]): Filters {
  return {
    status: f.status === 'open' ? OPEN_STATUSES : f.status,
    priority: f.priority,
    type: f.type,
    component: f.component,
    assigneeId: f.assignee === 'me' ? user.id : f.assignee,
    groupIds: f.group === 'mine' ? userGroupIds : f.group ? [f.group] : undefined,
    slaState: f.slaState,
    tagId: f.tagId,
    awaitingAgent: f.awaitingAgent,
    sort: f.slaState ? 'sla' : 'created',
  };
}

export interface TicketDeps {
  prisma: PrismaClient;
  config: ConfigService;
  sla: SlaService;
  routing: RoutingService;
  notifications: NotificationService;
  attachments: AttachmentService;
  mailer: OutboundMailer;
}

export class TicketService {
  private readonly prisma: PrismaClient;

  constructor(private readonly d: TicketDeps) {
    this.prisma = d.prisma;
  }

  /** Aplatit les relations et ajoute l'état SLA calculé à l'instant. */
  private toDto({ tags, slaPauses, _count, ...ticket }: TicketWithRelations, policy: SlaPolicy) {
    return {
      ...ticket,
      childCount: _count.children,
      tags: tags.map((t) => t.tag).sort((a, b) => a.name.localeCompare(b.name)),
      sla: this.d.sla.status({ ...ticket, slaPauses }, policy),
    };
  }

  /** Les utilisateurs sans `ticket:read:all` ne voient que leurs propres tickets ; les autres renvoient 404. */
  private visibilityFilter(user: CurrentUser): Prisma.TicketWhereInput {
    return hasPermission(user.role, 'ticket:read:all') ? {} : { requesterId: user.id };
  }

  private async findVisible(user: CurrentUser, id: number) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, ...this.visibilityFilter(user) },
      include: ticketInclude,
    });
    if (!ticket) throw notFound('Ticket introuvable');
    return ticket;
  }

  private async reload(db: PrismaClient | Tx, id: number) {
    return this.toDto(await db.ticket.findUniqueOrThrow({ where: { id }, include: ticketInclude }), await this.d.sla.policy());
  }

  async getVisible(user: CurrentUser, id: number) {
    return this.toDto(await this.findVisible(user, id), await this.d.sla.policy());
  }

  /** Détail avec les tickets rattachés, pour la page d'un ticket référent. */
  async getDetail(user: CurrentUser, id: number) {
    const [ticket, children, devLinks] = await Promise.all([
      this.getVisible(user, id),
      this.prisma.ticket.findMany({
        where: { parentId: id, ...this.visibilityFilter(user) },
        select: { id: true, subject: true, status: true, priority: true, requester: { select: { id: true, name: true } } },
        orderBy: { id: 'asc' },
      }),
      // Les liens vers l'outil de développement sont réservés au support et aux développeurs.
      hasPermission(user.role, 'ticket:read:all')
        ? this.prisma.devLink.findMany({
            where: { ticketId: id },
            select: { id: true, externalKey: true, url: true, title: true, externalStatus: true, fixVersion: true, integration: { select: { id: true, name: true, provider: true } } },
            orderBy: { createdAt: 'asc' },
          })
        : [],
    ]);
    return { ...ticket, children, devLinks };
  }

  /** Rattache le ticket à un ticket référent (un seul niveau), ou le détache avec `null`. */
  async setParent(user: CurrentUser, id: number, parentId: number | null) {
    ensure(user, 'ticket:qualify');
    const current = await this.findVisible(user, id);
    if (current.parentId === parentId) return this.getDetail(user, id);
    if (parentId !== null) {
      if (parentId === id) throw badRequest('Un ticket ne peut pas être son propre référent');
      const parent = await this.findVisible(user, parentId).catch(() => {
        throw badRequest(`Ticket référent #${parentId} introuvable`);
      });
      if (parent.parentId !== null) {
        throw conflict(`Le ticket #${parentId} est lui-même rattaché au #${parent.parentId} : choisissez ce dernier`);
      }
      if (current._count.children > 0) {
        throw conflict('Ce ticket est déjà le référent d’autres tickets et ne peut pas être rattaché');
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id }, data: { parentId } });
      const changes = { parentId: { from: current.parentId, to: parentId } };
      await tx.auditLog.create({
        data: { ticketId: id, actorId: user.id, action: parentId ? 'ticket.linked' : 'ticket.unlinked', changes },
      });
      // L'historique du référent garde aussi la trace des rattachements.
      for (const referentId of [current.parentId, parentId].filter((x): x is number => x !== null)) {
        await tx.auditLog.create({
          data: {
            ticketId: referentId,
            actorId: user.id,
            action: referentId === parentId ? 'ticket.child_linked' : 'ticket.child_unlinked',
            changes: { childId: id },
          },
        });
      }
    });
    return this.getDetail(user, id);
  }

  userGroupIds(userId: string) {
    return this.prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } }).then((m) => m.map((x) => x.groupId));
  }

  buildWhere(user: CurrentUser, f: Filters): Prisma.TicketWhereInput {
    return {
      ...this.visibilityFilter(user),
      ...(f.status && { status: { in: f.status } }),
      ...(f.priority && { priority: { in: f.priority } }),
      ...(f.type && { type: f.type }),
      ...(f.component && { component: f.component }),
      ...(f.assigneeId && { assigneeId: f.assigneeId === 'none' ? null : f.assigneeId }),
      ...(f.groupIds && { groupId: { in: f.groupIds } }),
      ...(f.slaState && { slaState: { in: f.slaState } }),
      ...(f.tagId && { tags: { some: { tagId: f.tagId } } }),
      ...(f.awaitingAgent !== undefined && { awaitingAgent: f.awaitingAgent }),
      ...(f.q && {
        OR: [
          // « 42 » ou « #42 » retrouve aussi le ticket par son numéro.
          ...(/^#?\d{1,9}$/.test(f.q) ? [{ id: Number(f.q.replace('#', '')) }] : []),
          { subject: { contains: f.q, mode: 'insensitive' } },
          { description: { contains: f.q, mode: 'insensitive' } },
        ],
      }),
    };
  }

  count(user: CurrentUser, f: Filters) {
    return this.prisma.ticket.count({ where: this.buildWhere(user, f) });
  }

  async list(user: CurrentUser, f: ListTicketsFilters) {
    const where = this.buildWhere(user, f);
    const orderBy: Prisma.TicketOrderByWithRelationInput[] =
      f.sort === 'sla'
        ? [{ slaDueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }];
    const [items, total, policy] = await Promise.all([
      this.prisma.ticket.findMany({ where, include: ticketInclude, orderBy, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
      this.prisma.ticket.count({ where }),
      this.d.sla.policy(),
    ]);
    return { items: items.map((t) => this.toDto(t, policy)), total, page: f.page, pageSize: f.pageSize };
  }

  private async assertGroup(groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group || !group.isActive) throw badRequest('Groupe inconnu ou inactif');
  }

  private async notifyAssignee(
    tx: Tx,
    ticket: { id: number; subject: string },
    assigneeId: string | null,
    actorId: string | null,
    kind: 'ticket.assigned' | 'ticket.customer_replied' = 'ticket.assigned',
  ) {
    if (!assigneeId || assigneeId === actorId) return;
    const message =
      kind === 'ticket.assigned'
        ? `Ticket #${ticket.id} vous est assigné : ${ticket.subject}`
        : `Le demandeur a répondu sur le ticket #${ticket.id} : ${ticket.subject}`;
    await this.d.notifications.notify(tx, [assigneeId], { ticketId: ticket.id, kind, message });
  }

  /** Clés des champs personnalisés visibles du demandeur ; les autres sont réservés au support. */
  async requesterFieldKeys(): Promise<Set<string>> {
    return new Set((await this.d.config.customFields()).filter((f) => f.forRequester).map((f) => f.key));
  }

  async create(user: CurrentUser, input: CreateTicketInput, system?: SystemCreateOptions) {
    if (input.priority !== undefined) ensure(user, 'ticket:priority:override');
    if (input.tagIds?.length) ensure(user, 'ticket:qualify');
    if (input.assigneeId) {
      ensure(user, 'ticket:assign');
      await this.assertAssignable(input.assigneeId);
    }
    if (input.groupId) {
      ensure(user, 'ticket:assign');
      await this.assertGroup(input.groupId);
    }
    if (input.requesterId && input.requesterId !== user.id) {
      ensure(user, 'ticket:qualify');
      await this.assertRequester(input.requesterId);
    }
    const type = input.type ?? DEFAULT_TICKET_TYPE;
    await this.d.config.assertOptionUsable('TYPE', type);
    await this.d.config.assertOptionUsable('COMPONENT', input.component);
    await this.d.config.assertOptionUsable('ENVIRONMENT', input.environment);
    const tagIds = [...new Set(input.tagIds ?? [])];
    await this.d.config.assertTagsUsable(tagIds);
    const custom = await this.d.config.resolveCustomValues(input.customValues, { current: undefined, requesterOnly: !isStaff(user) });

    const impact = input.impact ?? 'INDIVIDUAL';
    const urgency = input.urgency ?? 'MEDIUM';
    const data = {
      subject: input.subject,
      description: system?.descriptionPrefix ? `${system.descriptionPrefix}\n\n${input.description}` : input.description,
      type,
      component: input.component ?? null,
      environment: input.environment ?? null,
      impact,
      urgency,
      priority: input.priority ?? computePriority(impact, urgency, await this.d.config.priorityMatrix()),
      priorityOverridden: input.priority !== undefined,
      requesterId: input.requesterId ?? user.id,
      assigneeId: input.assigneeId ?? null,
    };
    const openedByCustomer = !isStaff(user) && data.requesterId === user.id;
    const presetGroupId = input.groupId ?? system?.groupId ?? undefined;
    const routedGroup = presetGroupId === undefined ? await this.d.routing.findGroup(data) : null;
    const groupId = presetGroupId ?? routedGroup?.id ?? null;

    return this.prisma.$transaction(async (tx) => {
      // Distribution automatique si le groupe vient du routage et que personne n'est désigné.
      const assigneeId =
        data.assigneeId ?? (routedGroup ? await this.d.routing.pickAssignee(tx, routedGroup) : null);
      const ticket = await tx.ticket.create({
        data: {
          ...data,
          assigneeId,
          groupId,
          ...(openedByCustomer && { lastRequesterReplyAt: new Date(), awaitingAgent: true }),
          channel: system?.channel ?? 'WEB',
          mailboxId: system?.mailboxId ?? null,
          customValues: custom!.values,
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
        },
        include: ticketInclude,
      });
      const { description: _description, ...snapshot } = data;
      await tx.auditLog.create({
        data: {
          ticketId: ticket.id,
          actorId: user.id,
          action: 'ticket.created',
          changes: {
            ...snapshot,
            assigneeId,
            groupId,
            tags: ticket.tags.map((t) => t.tag.name),
            ...(Object.keys(custom!.values).length > 0 && { customFields: Object.keys(custom!.values) }),
            ...(routedGroup && { routedTo: routedGroup.name }),
          },
        },
      });
      await this.notifyAssignee(tx, ticket, assigneeId, user.id);
      await this.d.sla.refresh(tx, ticket.id);
      return this.reload(tx, ticket.id);
    });
  }

  async update(user: CurrentUser, id: number, input: UpdateTicketInput) {
    const current = await this.findVisible(user, id);

    if (QUALIFICATION_FIELDS.some((f) => input[f] !== undefined) || input.subject !== undefined || input.description !== undefined) {
      ensure(user, 'ticket:qualify');
    }
    if (input.priority !== undefined) ensure(user, 'ticket:priority:override');
    let requester: { name: string; email: string } | null = null;
    if (input.requesterId !== undefined && input.requesterId !== current.requesterId) {
      ensure(user, 'ticket:qualify');
      requester = await this.assertRequester(input.requesterId);
    }
    if (input.assigneeId !== undefined) {
      ensure(user, 'ticket:assign');
      if (input.assigneeId) await this.assertAssignable(input.assigneeId);
    }
    if (input.groupId !== undefined) {
      ensure(user, 'ticket:assign');
      if (input.groupId) await this.assertGroup(input.groupId);
    }
    if (current.status === 'CLOSED') throw conflict('Un ticket clôturé ne peut plus être modifié');
    await this.d.config.assertOptionUsable('TYPE', input.type, current.type);
    await this.d.config.assertOptionUsable('COMPONENT', input.component, current.component);
    await this.d.config.assertOptionUsable('ENVIRONMENT', input.environment, current.environment);

    const currentTags = current.tags.map((t) => t.tag);
    const nextTagIds = input.tagIds && [...new Set(input.tagIds)];
    if (nextTagIds) {
      await this.d.config.assertTagsUsable(
        nextTagIds,
        currentTags.map((t) => t.id),
      );
    }

    const custom = await this.d.config.resolveCustomValues(input.customValues, {
      current: (current.customValues ?? {}) as CustomValues,
      requesterOnly: false,
    });
    const { priority: priorityInput, tagIds: _tagIds, customValues: _custom, ...fields } = input;
    const next: Partial<Ticket> = { ...fields };
    const impact = input.impact ?? current.impact;
    const urgency = input.urgency ?? current.urgency;
    if (priorityInput === null) {
      next.priority = computePriority(impact, urgency, await this.d.config.priorityMatrix());
      next.priorityOverridden = false;
    } else if (priorityInput !== undefined) {
      next.priority = priorityInput;
      next.priorityOverridden = true;
    } else if (!current.priorityOverridden) {
      next.priority = computePriority(impact, urgency, await this.d.config.priorityMatrix());
    }

    const changes = diff(current, next);
    if (custom && Object.keys(custom.changes).length > 0) {
      next.customValues = custom.values;
      Object.assign(changes, custom.changes);
    }
    // La description peut être longue et contenir des données personnelles : on ne journalise que le fait qu'elle a changé.
    if (changes.description) changes.description = { from: '[modifié]', to: '[modifié]' };
    // Le demandeur peut être un contact externe, inconnu de l'interface : on journalise son nom et son adresse.
    if (changes.requesterId) {
      delete changes.requesterId;
      changes.requester = {
        from: `${current.requester.name} <${current.requester.email}>`,
        to: requester && `${requester.name} <${requester.email}>`,
      };
    }

    const tagsChanged =
      nextTagIds !== undefined &&
      (nextTagIds.length !== currentTags.length || nextTagIds.some((tid) => !currentTags.some((t) => t.id === tid)));
    if (tagsChanged) {
      const names = await this.prisma.tag.findMany({ where: { id: { in: nextTagIds } }, select: { name: true } });
      changes.tags = { from: currentTags.map((t) => t.name).sort(), to: names.map((t) => t.name).sort() };
    }
    if (Object.keys(changes).length === 0) return this.toDto(current, await this.d.sla.policy());

    return this.prisma.$transaction(async (tx) => {
      // Verrou optimiste : échoue si le ticket a été modifié depuis sa lecture.
      // updatedAt est forcé pour que le seul changement de tags compte aussi comme une modification.
      const { count } = await tx.ticket.updateMany({
        where: { id, updatedAt: current.updatedAt },
        data: { ...next, customValues: next.customValues as Prisma.InputJsonObject | undefined, updatedAt: new Date() },
      });
      if (count === 0) throw conflict('Le ticket a été modifié entre-temps, veuillez recharger');
      if (tagsChanged) {
        await tx.ticketTag.deleteMany({ where: { ticketId: id } });
        await tx.ticketTag.createMany({ data: nextTagIds!.map((tagId) => ({ ticketId: id, tagId })) });
      }
      await tx.auditLog.create({
        data: { ticketId: id, actorId: user.id, action: 'ticket.updated', changes: changes as Prisma.InputJsonObject },
      });
      // Nouvelle priorité, nouveaux délais : les alertes déjà émises ne valent plus.
      if (changes.priority) await tx.slaAlert.deleteMany({ where: { ticketId: id } });
      if (changes.assigneeId) await this.notifyAssignee(tx, current, input.assigneeId ?? null, user.id);
      await this.d.sla.refresh(tx, id);
      return this.reload(tx, id);
    });
  }

  /** Réapplique les règles de routage (après une requalification, par exemple). */
  async route(user: CurrentUser, id: number) {
    ensure(user, 'ticket:assign');
    const current = await this.findVisible(user, id);
    if (current.status === 'CLOSED') throw conflict('Un ticket clôturé ne peut plus être modifié');
    const group = await this.d.routing.findGroup(current);
    if (!group) throw conflict('Aucune règle de routage ne correspond à ce ticket');

    return this.prisma.$transaction(async (tx) => {
      const assigneeId = current.assigneeId ?? (await this.d.routing.pickAssignee(tx, group));
      await tx.ticket.update({ where: { id }, data: { groupId: group.id, assigneeId } });
      await tx.auditLog.create({
        data: {
          ticketId: id,
          actorId: user.id,
          action: 'ticket.routed',
          changes: {
            groupId: { from: current.groupId, to: group.id },
            ...(assigneeId !== current.assigneeId && { assigneeId: { from: current.assigneeId, to: assigneeId } }),
            routedTo: group.name,
          },
        },
      });
      if (assigneeId !== current.assigneeId) await this.notifyAssignee(tx, current, assigneeId, user.id);
      return this.reload(tx, id);
    });
  }

  async transition(user: CurrentUser, id: number, to: TicketStatus) {
    ensure(user, 'ticket:transition');
    const current = await this.findVisible(user, id);
    return this.prisma.$transaction(async (tx) => {
      await this.applyTransition(tx, user.id, current, to, false);
      return this.reload(tx, id);
    });
  }

  /**
   * Amène le ticket au statut demandé par l'équipe de développement, en enchaînant les transitions
   * du workflow (ex. Qualification → Transmis aux dev → En cours). Un ticket résolu ou clôturé n'est
   * jamais touché. Renvoie `false` si rien n'a changé.
   */
  async advanceFromDev(ticketId: number, target: TicketStatus) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.ticket.findUnique({ where: { id: ticketId } });
      if (!current || !isOpenStatus(current.status) || current.status === target) return false;
      const path = workflowPath(current.status, target);
      if (!path) return false;
      let from: Ticket = current;
      for (const to of path) {
        await this.applyTransition(tx, null, from, to, true);
        from = { ...from, status: to };
      }
      return true;
    });
  }

  /** Change le statut et tient à jour les suspensions du délai de résolution. */
  private async applyTransition(tx: Tx, actorId: string | null, current: Ticket, to: TicketStatus, auto: boolean) {
    if (!canTransition(current.status, to)) {
      throw conflict(`Transition interdite : ${current.status} → ${to}`);
    }
    const now = new Date();
    const data: Prisma.TicketUpdateManyMutationInput = { status: to };
    if (to === 'RESOLVED') data.resolvedAt = now;
    if (to === 'CLOSED') data.closedAt = now;
    if (to === 'RESOLVED' || to === 'CLOSED') data.awaitingAgent = false;
    // Réouverture : la résolution précédente n'est plus valable.
    if (current.status === 'RESOLVED' && to === 'QUALIFYING') data.resolvedAt = null;

    const { count } = await tx.ticket.updateMany({ where: { id: current.id, status: current.status }, data });
    if (count === 0) throw conflict('Le statut a été modifié entre-temps, veuillez recharger');

    const wasPaused = isSlaPausedStatus(current.status);
    const paused = isSlaPausedStatus(to);
    if (!wasPaused && paused) await tx.slaPause.create({ data: { ticketId: current.id, startedAt: now } });
    if (wasPaused && !paused) {
      await tx.slaPause.updateMany({ where: { ticketId: current.id, endedAt: null }, data: { endedAt: now } });
      if (current.status === 'RESOLVED') await tx.slaAlert.deleteMany({ where: { ticketId: current.id, metric: 'RESOLUTION' } });
    }

    await tx.auditLog.create({
      data: {
        ticketId: current.id,
        actorId,
        action: 'ticket.status_changed',
        changes: { status: { from: current.status, to }, ...(auto && { auto: true }) },
      },
    });
    await this.d.sla.refresh(tx, current.id);
  }

  async listComments(user: CurrentUser, ticketId: number) {
    await this.findVisible(user, ticketId);
    return this.prisma.comment.findMany({
      where: { ticketId, ...(!hasPermission(user.role, 'comment:internal') && { isInternal: false }) },
      include: {
        ...commentInclude,
        // État d'envoi par e-mail, visible du support seulement.
        ...(isStaff(user) && { outbound: true }),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addComment(user: CurrentUser, ticketId: number, body: string, isInternal: boolean, options: CommentOptions = {}) {
    ensure(user, 'comment:create');
    ensure(user, isInternal ? 'comment:internal' : 'comment:public');
    const ticket = await this.findVisible(user, ticketId);
    if (ticket.status === 'CLOSED') throw conflict('Un ticket clôturé ne peut plus être commenté');

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: { ticketId, authorId: user.id, body, isInternal, channel: options.channel ?? 'WEB', messageId: options.messageId },
      });
      for (const file of options.files ?? []) {
        await this.d.attachments.save(tx, ticketId, created.id, file, user.id);
      }
      // Première réponse (FRT) : premier commentaire public d'un membre du support.
      if (!isInternal && isStaff(user) && !ticket.firstResponseAt) {
        await tx.ticket.updateMany({
          where: { id: ticketId, firstResponseAt: null },
          data: { firstResponseAt: created.createdAt },
        });
      }
      // Qui a parlé en dernier : une réponse du support solde l'attente, un message du demandeur la crée.
      if (!isInternal && isStaff(user)) {
        await tx.ticket.update({
          where: { id: ticketId },
          data: { lastAgentReplyAt: created.createdAt, awaitingAgent: false, updatedAt: ticket.updatedAt },
        });
      } else if (!isInternal && user.id === ticket.requesterId) {
        await tx.ticket.update({
          where: { id: ticketId },
          data: {
            lastRequesterReplyAt: created.createdAt,
            awaitingAgent: !['RESOLVED', 'CLOSED'].includes(ticket.status),
            updatedAt: ticket.updatedAt,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          ticketId,
          actorId: user.id,
          action: 'comment.created',
          changes: { commentId: created.id, isInternal, ...(options.channel === 'EMAIL' && { channel: 'EMAIL' }) },
        },
      });
      // Le demandeur a répondu : le ticket reprend son cours et l'agent est prévenu.
      if (!isInternal && user.id === ticket.requesterId && ticket.status === 'WAITING_CUSTOMER') {
        await this.applyTransition(tx, user.id, ticket, 'QUALIFYING', true);
        await this.notifyAssignee(tx, ticket, ticket.assigneeId, user.id, 'ticket.customer_replied');
      } else {
        await this.d.sla.refresh(tx, ticketId);
      }
      // Réponse publique du support : envoyée par e-mail au demandeur.
      if (!isInternal && isStaff(user)) await this.d.mailer.enqueueComment(tx, ticketId, created.id);
      return tx.comment.findUniqueOrThrow({ where: { id: created.id }, include: commentInclude });
    });
  }

  /** Pièce jointe de la demande initiale (hors commentaire). */
  saveAttachment(tx: Tx, ticketId: number, file: IncomingFile, userId: string | null) {
    return this.d.attachments.save(tx, ticketId, null, file, userId);
  }

  /** Ajoute des pièces jointes à la demande initiale depuis l'interface. */
  async addAttachments(user: CurrentUser, ticketId: number, files: IncomingFile[]) {
    ensure(user, 'comment:create');
    const ticket = await this.findVisible(user, ticketId);
    if (ticket.status === 'CLOSED') throw conflict('Un ticket clôturé ne peut plus être modifié');
    return this.prisma.$transaction(async (tx) => {
      const saved = [];
      for (const file of files) saved.push(await this.d.attachments.save(tx, ticketId, null, file, user.id));
      await tx.auditLog.create({
        data: { ticketId, actorId: user.id, action: 'attachment.added', changes: { files: saved.map((a) => a.filename) } },
      });
      return saved;
    });
  }

  /**
   * Fusionne un doublon dans le ticket conservé (CdC §2.2) : la demande et les messages
   * publics du doublon sont recopiés en note interne, le doublon est clôturé, et les
   * e-mails qui lui répondent arrivent désormais dans le ticket conservé.
   */
  async merge(user: CurrentUser, sourceId: number, targetId: number) {
    ensure(user, 'ticket:qualify');
    ensure(user, 'ticket:transition');
    if (sourceId === targetId) throw badRequest('Un ticket ne peut pas être fusionné avec lui-même');
    const source = await this.findVisible(user, sourceId);
    const target = await this.findVisible(user, targetId).catch(() => {
      throw badRequest(`Ticket #${targetId} introuvable`);
    });
    if (source.status === 'CLOSED') throw conflict(`Le ticket #${sourceId} est déjà clôturé`);
    if (target.status === 'CLOSED' || target.mergedIntoId) throw conflict(`Le ticket #${targetId} est clôturé`);

    const comments = await this.prisma.comment.findMany({
      where: { ticketId: sourceId, isInternal: false },
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const summary = [
      `Ticket #${sourceId} fusionné ici : « ${source.subject} », demandé par ${source.requester.name} (${source.requester.email}).`,
      '',
      source.description,
      ...comments.map((c) => `\n— ${c.author.name}, ${c.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC :\n${c.body}`),
    ].join('\n');

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.comment.create({ data: { ticketId: targetId, authorId: user.id, body: summary.slice(0, 50_000), isInternal: true } });
      await tx.comment.create({
        data: { ticketId: sourceId, authorId: user.id, body: `Fusionné dans le ticket #${targetId}.`, isInternal: true },
      });
      // Les pièces jointes et les tickets rattachés suivent le ticket conservé.
      await tx.attachment.updateMany({ where: { ticketId: sourceId }, data: { ticketId: targetId } });
      await tx.ticket.updateMany({ where: { parentId: sourceId }, data: { parentId: targetId } });
      await tx.ticket.update({
        where: { id: sourceId },
        data: { status: 'CLOSED', closedAt: now, mergedIntoId: targetId, awaitingAgent: false },
      });
      await tx.slaPause.updateMany({ where: { ticketId: sourceId, endedAt: null }, data: { endedAt: now } });
      await tx.slaPause.create({ data: { ticketId: sourceId, startedAt: now } });
      await tx.auditLog.create({
        data: { ticketId: sourceId, actorId: user.id, action: 'ticket.merged', changes: { mergedInto: targetId, status: { from: source.status, to: 'CLOSED' } } },
      });
      await tx.auditLog.create({
        data: { ticketId: targetId, actorId: user.id, action: 'ticket.merged_from', changes: { mergedFrom: sourceId } },
      });
      await this.d.sla.refresh(tx, sourceId);
      return this.reload(tx, targetId);
    });
  }

  async auditTrail(user: CurrentUser, ticketId: number) {
    ensure(user, 'audit:read');
    await this.findVisible(user, ticketId);
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

  private async assertRequester(userId: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!requester || !requester.isActive) throw badRequest('Demandeur introuvable ou désactivé');
    return requester;
  }
}
