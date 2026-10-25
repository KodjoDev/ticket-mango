/**
 * Engagements de service (CdC §7.1) : délais de première réponse et de résolution.
 */
import { addBusinessMinutes, businessMinutesBetween, DEFAULT_BUSINESS_HOURS, type BusinessHours } from './business-time';
import type { Priority } from './priority';

export type SlaCalendar = 'ALWAYS' | 'BUSINESS';

export const SLA_CALENDAR_LABELS: Record<SlaCalendar, string> = {
  ALWAYS: '24/7',
  BUSINESS: 'Heures ouvrées',
};

export interface SlaTarget {
  firstResponseMinutes: number;
  resolutionMinutes: number;
  calendar: SlaCalendar;
}

export interface SlaPolicy {
  targets: Record<Priority, SlaTarget>;
  businessHours: BusinessHours;
  /** Pourcentage du délai consommé à partir duquel le ticket passe « à risque ». */
  warningPercent: number;
}

const H = 60;
export const DEFAULT_SLA_POLICY: SlaPolicy = {
  targets: {
    P0: { firstResponseMinutes: 15, resolutionMinutes: 2 * H, calendar: 'ALWAYS' },
    P1: { firstResponseMinutes: 15, resolutionMinutes: 2 * H, calendar: 'ALWAYS' },
    P2: { firstResponseMinutes: 1 * H, resolutionMinutes: 8 * H, calendar: 'BUSINESS' },
    P3: { firstResponseMinutes: 4 * H, resolutionMinutes: 48 * H, calendar: 'BUSINESS' },
    P4: { firstResponseMinutes: 4 * H, resolutionMinutes: 48 * H, calendar: 'BUSINESS' },
  },
  businessHours: DEFAULT_BUSINESS_HOURS,
  warningPercent: 80,
};

/**
 * État d'un délai : en cours (OK, à risque, dépassé), suspendu, ou terminé
 * (tenu ou manqué).
 */
export type SlaMetricState = 'OK' | 'WARNING' | 'BREACHED' | 'PAUSED' | 'MET' | 'MISSED';

/** État global stocké sur le ticket pour filtrer et trier. */
export const SLA_STATES = ['OK', 'WARNING', 'BREACHED', 'PAUSED', 'DONE'] as const;
export type SlaState = (typeof SLA_STATES)[number];

export const SLA_STATE_LABELS: Record<SlaState, string> = {
  OK: 'Dans les délais',
  WARNING: 'À risque',
  BREACHED: 'Dépassé',
  PAUSED: 'En pause',
  DONE: 'Terminé',
};

export interface SlaMetric {
  state: SlaMetricState;
  targetMinutes: number;
  elapsedMinutes: number;
  /** Négatif une fois le délai dépassé. Minutes du calendrier du SLA (ouvrées ou continues). */
  remainingMinutes: number;
  /** Échéance, tant que le délai court et n'est pas dépassé. */
  dueAt: Date | null;
}

export interface SlaStatus {
  calendar: SlaCalendar;
  firstResponse: SlaMetric;
  resolution: SlaMetric;
  state: SlaState;
  /** Échéance la plus proche parmi les délais en cours. */
  dueAt: Date | null;
}

export interface SlaInput {
  priority: Priority;
  createdAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  /** Périodes de suspension (attente du client, ticket résolu). */
  pauses: { startedAt: Date; endedAt: Date | null }[];
  now: Date;
}

export function computeSla(input: SlaInput, policy: SlaPolicy = DEFAULT_SLA_POLICY): SlaStatus {
  const target = policy.targets[input.priority];
  const business = target.calendar === 'BUSINESS';
  const between = (a: Date, b: Date) =>
    business ? businessMinutesBetween(a, b, policy.businessHours) : Math.max(0, Math.floor((+b - +a) / 60_000));
  const after = (from: Date, minutes: number) =>
    business ? addBusinessMinutes(from, minutes, policy.businessHours) : new Date(+from + minutes * 60_000);

  const metric = (targetMinutes: number, elapsed: number, done: boolean, paused: boolean): SlaMetric => {
    const remaining = targetMinutes - elapsed;
    const state: SlaMetricState = done
      ? remaining >= 0
        ? 'MET'
        : 'MISSED'
      : paused
        ? 'PAUSED'
        : remaining <= 0
          ? 'BREACHED'
          : elapsed >= (targetMinutes * policy.warningPercent) / 100
            ? 'WARNING'
            : 'OK';
    const running = state === 'OK' || state === 'WARNING';
    return {
      state,
      targetMinutes,
      elapsedMinutes: elapsed,
      remainingMinutes: remaining,
      dueAt: running ? after(input.now, remaining) : null,
    };
  };

  const frEnd = input.firstResponseAt ?? input.now;
  const firstResponse = metric(target.firstResponseMinutes, between(input.createdAt, frEnd), !!input.firstResponseAt, false);

  const resEnd = input.resolvedAt ?? input.now;
  const pausedMinutes = input.pauses
    .filter((p) => p.startedAt < resEnd)
    .reduce((sum, p) => {
      const end = p.endedAt && p.endedAt < resEnd ? p.endedAt : resEnd;
      return sum + between(p.startedAt, end);
    }, 0);
  const openPause = !input.resolvedAt && input.pauses.some((p) => p.endedAt === null);
  const resolution = metric(
    target.resolutionMinutes,
    Math.max(0, between(input.createdAt, resEnd) - pausedMinutes),
    !!input.resolvedAt,
    openPause,
  );

  const running = [firstResponse, resolution].filter((m) => !['MET', 'MISSED'].includes(m.state));
  const state: SlaState = running.some((m) => m.state === 'BREACHED')
    ? 'BREACHED'
    : running.some((m) => m.state === 'WARNING')
      ? 'WARNING'
      : running.some((m) => m.state === 'OK')
        ? 'OK'
        : running.length > 0
          ? 'PAUSED'
          : 'DONE';
  const dues = running.map((m) => m.dueAt).filter((d): d is Date => d !== null);
  return {
    calendar: target.calendar,
    firstResponse,
    resolution,
    state,
    dueAt: dues.length ? new Date(Math.min(...dues.map(Number))) : null,
  };
}
