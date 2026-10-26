import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api/client';
import { ErrorMessage, formatDate, PriorityBadge, StatusBadge } from './ui';

/** Autres tickets du demandeur : contexte pour répondre (récurrence, demandes en cours). */
export function RequesterHistory({ ticketId }: { ticketId: number }) {
  const { data, error } = useQuery({ queryKey: ['ticket', ticketId, 'requester-history'], queryFn: () => api.requesterHistory(ticketId) });
  return (
    <section className="card">
      <h2>Historique du demandeur</h2>
      <ErrorMessage error={error} />
      {data && data.items.length === 0 && <p className="muted small">Aucun autre ticket pour ce demandeur.</p>}
      {data && data.items.length > 0 && (
        <>
          <ul className="requester-history">
            {data.items.map((t) => (
              <li key={t.id}>
                <Link to={`/tickets/${t.id}`}>
                  <span className="muted">#{t.id}</span> {t.subject}
                </Link>
                <span className="requester-history-meta">
                  <PriorityBadge priority={t.priority} />
                  <StatusBadge status={t.status} />
                  <span className="muted small">{formatDate(t.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
          {data.total > data.items.length && <p className="muted small">{data.total - data.items.length} ticket(s) plus ancien(s) non affiché(s).</p>}
        </>
      )}
    </section>
  );
}
