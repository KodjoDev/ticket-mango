import { useQuery } from '@tanstack/react-query';
import { PRIORITY_LABELS, type Count } from '@ticketing/shared';
import { useState } from 'react';
import { api } from '../api/client';
import { ErrorMessage, Field, Spinner } from '../components/ui';

const day = (d: Date) => d.toISOString().slice(0, 10);

const CHANNELS: Record<string, string> = { WEB: 'Web', EMAIL: 'E-mail' };

function duration(minutes: number | null) {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return h < 48 ? `${h} h ${String(minutes % 60).padStart(2, '0')}` : `${Math.round(h / 24)} j`;
}

function Breakdown({ title, rows, label }: { title: string; rows: Count[]; label: (key: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted small">Aucune donnée.</p>
      ) : (
        <ul className="bars">
          {rows.map((r) => (
            <li key={r.key}>
              <span>{label(r.key)}</span>
              <span className="bar" style={{ width: `${(r.count / max) * 100}%` }} aria-hidden="true" />
              <strong>{r.count}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ReportsPage() {
  const [range, setRange] = useState({ from: day(new Date(Date.now() - 29 * 86_400_000)), to: day(new Date()) });
  const { data, error, isPending } = useQuery({ queryKey: ['report', range], queryFn: () => api.report(range.from, range.to), enabled: range.from <= range.to });
  return (
    <>
      <header className="page-header">
        <h1>Statistiques</h1>
      </header>
      <div className="card inline-form">
        <Field label="Du">
          <input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </Field>
        <Field label="Au">
          <input type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </Field>
      </div>
      <ErrorMessage error={error} />
      {isPending && <Spinner />}
      {data && (
        <>
          <div className="kpis">
            <div className="card">
              <span className="muted small">Tickets créés</span>
              <strong>{data.total}</strong>
            </div>
            <div className="card">
              <span className="muted small">Première réponse (moyenne)</span>
              <strong>{duration(data.avgFirstResponseMinutes)}</strong>
            </div>
            <div className="card">
              <span className="muted small">Résolution (moyenne)</span>
              <strong>{duration(data.avgResolutionMinutes)}</strong>
            </div>
            <div className="card">
              <span className="muted small">SLA respectés</span>
              <strong>{data.slaCompliance === null ? '—' : `${Math.round(data.slaCompliance * 100)} %`}</strong>
            </div>
          </div>
          <Breakdown title="Volume par canal" rows={data.byChannel} label={(k) => CHANNELS[k] ?? k} />
          <Breakdown title="Volume par type" rows={data.byType} label={(k) => k} />
          <Breakdown title="Volume par priorité" rows={data.byPriority} label={(k) => PRIORITY_LABELS[k as keyof typeof PRIORITY_LABELS] ?? k} />
          <Breakdown title="Top 5 des modules générateurs de bugs" rows={data.topBugComponents} label={(k) => (k === 'NONE' ? 'Non renseigné' : k)} />
        </>
      )}
    </>
  );
}
