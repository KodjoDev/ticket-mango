import { businessMinutesBetween, formatDuration, SLA_CALENDAR_LABELS, type SlaMetricState } from '@ticketing/shared';
import { useEffect, useState } from 'react';
import type { SlaMetricDto, SlaStatusDto } from '../api/types';
import { useConfig } from '../config/ConfigContext';
import { formatDate } from './ui';

/** Heure courante, rafraîchie chaque minute pour faire avancer les comptes à rebours. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Durée lisible à partir de minutes (ex. 95 → « 1 h 35 », 3 000 → « 2 j 2 h »). */
export function humanMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m >= 24 * 60) {
    const days = Math.floor(m / (24 * 60));
    const hours = Math.floor((m % (24 * 60)) / 60);
    return hours ? `${days} j ${hours} h` : `${days} j`;
  }
  return formatDuration(m);
}

/** Minutes restantes à l'instant, dans le calendrier du SLA (ouvré ou continu). */
function useRemaining(metric: SlaMetricDto, calendar: SlaStatusDto['calendar']): number {
  const { slaPolicy } = useConfig();
  const now = useNow();
  if (!metric.dueAt) return metric.remainingMinutes;
  const due = new Date(metric.dueAt);
  return calendar === 'BUSINESS'
    ? businessMinutesBetween(now, due, slaPolicy.businessHours)
    : Math.max(0, (due.getTime() - now.getTime()) / 60_000);
}

const STATE_CLASS: Record<SlaMetricState, string> = {
  OK: 'sla-ok',
  WARNING: 'sla-warning',
  BREACHED: 'sla-breached',
  PAUSED: 'sla-paused',
  MET: 'sla-met',
  MISSED: 'sla-missed',
};

function MetricBadge({ metric, calendar, label }: { metric: SlaMetricDto; calendar: SlaStatusDto['calendar']; label?: string }) {
  const remaining = useRemaining(metric, calendar);
  const text = (() => {
    switch (metric.state) {
      case 'OK':
      case 'WARNING':
        return humanMinutes(remaining);
      case 'BREACHED':
        return `−${humanMinutes(-metric.remainingMinutes)}`;
      case 'PAUSED':
        return 'En pause';
      case 'MET':
        return 'Tenu';
      case 'MISSED':
        return 'Manqué';
    }
  })();
  const title = metric.dueAt ? `Échéance : ${formatDate(metric.dueAt)}` : undefined;
  return (
    <span className={`badge sla ${STATE_CLASS[metric.state]}`} title={title}>
      {label && <span className="sla-label">{label}</span>}
      {text}
    </span>
  );
}

/** Délai le plus pressant d'un ticket, pour la liste. */
export function SlaBadge({ sla }: { sla: SlaStatusDto }) {
  const order: SlaMetricState[] = ['BREACHED', 'WARNING', 'OK', 'PAUSED', 'MISSED', 'MET'];
  const metrics = [
    { m: sla.firstResponse, label: '1re rép.' },
    { m: sla.resolution, label: 'Résol.' },
  ];
  const pick = metrics.sort((a, b) => {
    const byState = order.indexOf(a.m.state) - order.indexOf(b.m.state);
    if (byState !== 0) return byState;
    return (a.m.dueAt ? Date.parse(a.m.dueAt) : Infinity) - (b.m.dueAt ? Date.parse(b.m.dueAt) : Infinity);
  })[0]!;
  return <MetricBadge metric={pick.m} calendar={sla.calendar} label={pick.label} />;
}

function MetricRow({ title, metric, calendar }: { title: string; metric: SlaMetricDto; calendar: SlaStatusDto['calendar'] }) {
  return (
    <div className="sla-row">
      <div>
        <strong>{title}</strong>
        <div className="muted small">
          Objectif {humanMinutes(metric.targetMinutes)}
          {metric.dueAt && ` · échéance ${formatDate(metric.dueAt)}`}
        </div>
      </div>
      <MetricBadge metric={metric} calendar={calendar} />
    </div>
  );
}

export function SlaCard({ sla }: { sla: SlaStatusDto }) {
  return (
    <section className={`card sla-card sla-card-${sla.state.toLowerCase()}`}>
      <h2>
        SLA <span className="muted small">· {SLA_CALENDAR_LABELS[sla.calendar]}</span>
      </h2>
      <MetricRow title="Première réponse" metric={sla.firstResponse} calendar={sla.calendar} />
      <MetricRow title="Résolution" metric={sla.resolution} calendar={sla.calendar} />
    </section>
  );
}
