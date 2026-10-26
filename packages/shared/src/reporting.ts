/**
 * Reporting (CdC §7.2) : agrégation des tickets d'une période.
 */

export interface ReportTicket {
  channel: string;
  type: string;
  priority: string;
  component: string | null;
  slaState: string;
  createdAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
}

export interface Count {
  key: string;
  count: number;
}

export interface Report {
  total: number;
  byChannel: Count[];
  byType: Count[];
  byPriority: Count[];
  /** Moyennes en minutes calendaires ; null sans donnée. */
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  /** Part des tickets dont le SLA n'est pas dépassé, entre 0 et 1 ; null sans ticket évalué. */
  slaCompliance: number | null;
  /** Modules ayant généré le plus de bugs et d'incidents (5 au plus). */
  topBugComponents: Count[];
}

const BUG_TYPES = ['BUG', 'MAJOR_INCIDENT'];
/** Un SLA en pause n'est pas encore évaluable. */
const EVALUATED_SLA = ['OK', 'WARNING', 'BREACHED', 'DONE'];

function tally(keys: string[]): Count[] {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function averageMinutes(pairs: [Date, Date | null][]): number | null {
  const spans = pairs.flatMap(([from, to]) => (to && to >= from ? [(to.getTime() - from.getTime()) / 60_000] : []));
  return spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length) : null;
}

export function buildReport(tickets: ReportTicket[]): Report {
  const evaluated = tickets.filter((t) => EVALUATED_SLA.includes(t.slaState));
  return {
    total: tickets.length,
    byChannel: tally(tickets.map((t) => t.channel)),
    byType: tally(tickets.map((t) => t.type)),
    byPriority: tally(tickets.map((t) => t.priority)),
    avgFirstResponseMinutes: averageMinutes(tickets.map((t) => [t.createdAt, t.firstResponseAt])),
    avgResolutionMinutes: averageMinutes(tickets.map((t) => [t.createdAt, t.resolvedAt])),
    slaCompliance: evaluated.length ? evaluated.filter((t) => t.slaState !== 'BREACHED').length / evaluated.length : null,
    topBugComponents: tally(tickets.filter((t) => BUG_TYPES.includes(t.type)).map((t) => t.component ?? 'NONE')).slice(0, 5),
  };
}
