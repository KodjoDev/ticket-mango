import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Priority,
  type TicketStatus,
} from '@ticketing/shared';
import type { ReactNode } from 'react';
import { ApiError } from '../api/client';

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`badge priority-${priority.toLowerCase()}`} title={PRIORITY_LABELS[priority]}>
      {priority}
    </span>
  );
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge status status-${status.toLowerCase()}`}>{STATUS_LABELS[status]}</span>;
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Une erreur est survenue';
  const issues = error instanceof ApiError ? error.issues : [];
  return (
    <div className="alert" role="alert">
      {message}
      {issues.length > 0 && (
        <ul>
          {issues.map((i) => (
            <li key={i.path}>
              <code>{i.path}</code> : {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <p className="muted" role="status">
      {label}
    </p>
  );
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
export const formatDate = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : '—');

/** Options d'un <select> à partir d'une liste de valeurs et de leurs libellés. */
export function options<T extends string>(values: readonly T[], labels: Record<T, string>) {
  return values.map((v) => (
    <option key={v} value={v}>
      {labels[v]}
    </option>
  ));
}
