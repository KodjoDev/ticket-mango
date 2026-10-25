import type { Prisma, PrismaClient, Ticket } from '@prisma/client';
import { computeSla, type SlaPolicy, type SlaStatus } from '@ticketing/shared';
import type { ConfigService } from './config';

type Db = PrismaClient | Prisma.TransactionClient;
type SlaTicket = Pick<Ticket, 'id' | 'priority' | 'createdAt' | 'firstResponseAt' | 'resolvedAt'> & {
  slaPauses: { startedAt: Date; endedAt: Date | null }[];
};

export const slaPausesSelect = { select: { startedAt: true, endedAt: true } } as const;

export class SlaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: ConfigService,
  ) {}

  policy(): Promise<SlaPolicy> {
    return this.config.slaPolicy();
  }

  status(t: SlaTicket, policy: SlaPolicy, now = new Date()): SlaStatus {
    return computeSla(
      {
        priority: t.priority,
        createdAt: t.createdAt,
        firstResponseAt: t.firstResponseAt,
        resolvedAt: t.resolvedAt,
        pauses: t.slaPauses,
        now,
      },
      policy,
    );
  }

  /** Recalcule et enregistre l'état SLA stocké (filtres, tri, vues). */
  async refresh(db: Db, ticketId: number, policy?: SlaPolicy, now = new Date()): Promise<SlaStatus> {
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { slaPauses: slaPausesSelect } });
    const status = this.status(ticket, policy ?? (await this.policy()), now);
    await db.ticket.update({
      where: { id: ticketId },
      // Ne modifie pas updatedAt : ce recalcul n'est pas une modification du ticket.
      data: { slaState: status.state, slaDueAt: status.dueAt, updatedAt: ticket.updatedAt },
    });
    return status;
  }
}
