import type { AuditEntry } from '../api/types';
import { AUDIT_ACTION_LABELS, FIELD_LABELS, formatAuditValue } from '../labels';
import { useConfig } from '../config/ConfigContext';
import { formatDate } from './ui';

type Diff = Record<string, { from: unknown; to: unknown }>;

export function AuditTrail({ entries, names }: { entries: AuditEntry[]; names: Map<string, string> }) {
  const { label } = useConfig();
  const ctx = { names, label };
  return (
    <section className="card">
      <h2>Historique</h2>
      <ol className="audit">
        {entries.map((e) => (
          <li key={e.id}>
            <div>
              <strong>{e.actor?.name ?? 'Système'}</strong> {AUDIT_ACTION_LABELS[e.action] ?? e.action}
              {e.action === 'comment.created' && e.changes?.isInternal === true && ' (note interne)'}
              <span className="muted small"> · {formatDate(e.createdAt)}</span>
            </div>
            {(e.action === 'ticket.updated' || e.action === 'ticket.status_changed') && e.changes && (
              <ul className="audit-changes">
                {Object.entries(e.changes as Diff).map(([field, { from, to }]) => (
                  <li key={field}>
                    {FIELD_LABELS[field] ?? field} : {formatAuditValue(field, from, ctx)} →{' '}
                    <strong>{formatAuditValue(field, to, ctx)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
