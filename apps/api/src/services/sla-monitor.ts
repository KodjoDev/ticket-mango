import type { PrismaClient } from '@prisma/client';
import { isOpenStatus, PRIORITY_LABELS, TICKET_STATUSES, type SlaMetric } from '@ticketing/shared';
import type { NotificationService } from './notifications';
import { slaPausesSelect, type SlaService } from './sla';

/** Identifiant arbitraire du verrou consultatif PostgreSQL : une seule instance surveille à la fois. */
const LOCK_KEY = 74_201;
const OPEN_STATUSES = TICKET_STATUSES.filter(isOpenStatus);

const METRICS = [
  { key: 'firstResponse', code: 'FIRST_RESPONSE', label: 'première réponse' },
  { key: 'resolution', code: 'RESOLUTION', label: 'résolution' },
] as const;

/**
 * Surveillance périodique des SLA : met à jour l'état stocké des tickets ouverts et
 * notifie une seule fois par délai et par niveau (à risque, dépassé).
 * Destinataires : l'agent assigné et le responsable du groupe ; sans agent, les membres du groupe.
 */
export class SlaMonitor {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sla: SlaService,
    private readonly notifications: NotificationService,
  ) {}

  async run(now = new Date()): Promise<{ checked: number; alerts: number }> {
    return this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`;
        if (!lock?.locked) return { checked: 0, alerts: 0 };

        const policy = await this.sla.policy();
        const tickets = await tx.ticket.findMany({
          where: { status: { in: OPEN_STATUSES } },
          include: {
            slaPauses: slaPausesSelect,
            group: { select: { managerId: true, members: { select: { userId: true } } } },
          },
        });

        let alerts = 0;
        for (const t of tickets) {
          const status = this.sla.status(t, policy, now);
          if (status.state !== t.slaState || status.dueAt?.getTime() !== t.slaDueAt?.getTime()) {
            await tx.ticket.update({
              where: { id: t.id },
              data: { slaState: status.state, slaDueAt: status.dueAt, updatedAt: t.updatedAt },
            });
          }
          for (const m of METRICS) {
            const metric: SlaMetric = status[m.key];
            const level = metric.state === 'BREACHED' ? 'BREACHED' : metric.state === 'WARNING' ? 'WARNING' : null;
            if (!level) continue;
            const { count } = await tx.slaAlert.createMany({
              data: [{ ticketId: t.id, metric: m.code, level }],
              skipDuplicates: true,
            });
            if (count === 0) continue;
            alerts++;
            const recipients = [
              ...(t.assigneeId ? [t.assigneeId] : (t.group?.members.map((x) => x.userId) ?? [])),
              ...(t.group?.managerId ? [t.group.managerId] : []),
            ];
            await this.notifications.notify(tx, recipients, {
              ticketId: t.id,
              kind: level === 'BREACHED' ? 'sla.breached' : 'sla.warning',
              message:
                level === 'BREACHED'
                  ? `SLA de ${m.label} dépassé sur le ticket #${t.id} (${PRIORITY_LABELS[t.priority]})`
                  : `SLA de ${m.label} à risque sur le ticket #${t.id} (${PRIORITY_LABELS[t.priority]})`,
            });
          }
        }
        return { checked: tickets.length, alerts };
      },
      { timeout: 60_000 },
    );
  }

  start(intervalMs: number, onError: (err: unknown) => void) {
    const tick = () => void this.run().catch(onError);
    tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
