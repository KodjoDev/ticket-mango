import type { Distribution, Prisma, PrismaClient } from '@prisma/client';
import { hasPermission, isOpenStatus, TICKET_STATUSES, type Priority } from '@ticketing/shared';

type Tx = Prisma.TransactionClient;

export interface RuleConditions {
  type?: string[];
  component?: string[];
  environment?: string[];
  priority?: Priority[];
}

export interface RoutableTicket {
  type: string;
  component: string | null;
  environment: string | null;
  priority: Priority;
}

/** Une condition absente ou vide accepte toute valeur ; sinon la valeur du ticket doit y figurer. */
export function matches(c: RuleConditions, t: RoutableTicket): boolean {
  const ok = (allowed: string[] | undefined, value: string | null) => !allowed?.length || (value !== null && allowed.includes(value));
  return ok(c.type, t.type) && ok(c.component, t.component) && ok(c.environment, t.environment) && ok(c.priority, t.priority);
}

const OPEN_STATUSES = TICKET_STATUSES.filter(isOpenStatus);

/**
 * Routage (CdC §3.3) : la première règle active qui correspond désigne le groupe,
 * puis le mode de distribution du groupe choisit éventuellement l'agent.
 */
export class RoutingService {
  constructor(private readonly prisma: PrismaClient) {}

  async findGroup(t: RoutableTicket) {
    const rules = await this.prisma.routingRule.findMany({
      where: { isActive: true, group: { isActive: true } },
      orderBy: { position: 'asc' },
      include: { group: true },
    });
    return rules.find((r) => matches(r.conditions as RuleConditions, t))?.group ?? null;
  }

  /** Agents du groupe pouvant recevoir un ticket, dans un ordre stable. */
  private async eligibleMembers(tx: Tx, groupId: string) {
    const members = await tx.groupMember.findMany({
      where: { groupId, user: { isActive: true } },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    return members
      .map((m) => m.user)
      .filter((u) => hasPermission(u.role, 'ticket:transition'))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** Agent désigné selon le mode de distribution, ou null (mode manuel, groupe vide). */
  async pickAssignee(
    tx: Tx,
    group: { id: string; distribution: Distribution; lastAssignedUserId: string | null },
  ): Promise<string | null> {
    if (group.distribution === 'MANUAL') return null;
    const members = await this.eligibleMembers(tx, group.id);
    if (members.length === 0) return null;

    let chosen: string;
    if (group.distribution === 'ROUND_ROBIN') {
      const last = members.findIndex((m) => m.id === group.lastAssignedUserId);
      chosen = members[(last + 1) % members.length]!.id;
    } else {
      // Charge : le moins de tickets ouverts ; à égalité, l'ordre du tour de rôle.
      const loads = await tx.ticket.groupBy({
        by: ['assigneeId'],
        where: { assigneeId: { in: members.map((m) => m.id) }, status: { in: OPEN_STATUSES } },
        _count: { _all: true },
      });
      const load = (id: string) => loads.find((l) => l.assigneeId === id)?._count._all ?? 0;
      chosen = members.reduce((best, m) => (load(m.id) < load(best.id) ? m : best), members[0]!).id;
    }
    await tx.group.update({ where: { id: group.id }, data: { lastAssignedUserId: chosen } });
    return chosen;
  }
}
