import { useQuery } from '@tanstack/react-query';
import { INCIDENT_STATUS_LABELS } from '@ticketing/shared';
import { publicApi } from '../api/client';
import type { PublicIncident } from '../api/types';
import { ErrorMessage, formatDate, Spinner } from '../components/ui';

function Incident({ incident }: { incident: PublicIncident }) {
  return (
    <article className="card incident">
      <h3>
        <span className={`badge incident-status ${incident.status.toLowerCase()}`}>{INCIDENT_STATUS_LABELS[incident.status]}</span> {incident.title}
      </h3>
      <ol className="incident-timeline">
        {incident.updates.map((u, i) => (
          <li key={i}>
            <strong>{INCIDENT_STATUS_LABELS[u.status]}</strong> <span className="muted small">{formatDate(u.createdAt)}</span>
            <p>{u.message}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}

/** Status page publique : aucune connexion requise. */
export function StatusPage() {
  const status = useQuery({ queryKey: ['public-status'], queryFn: publicApi.status, refetchInterval: 60_000 });
  const data = status.data;
  return (
    <div className="login">
      <div className="status-page">
        <h1>
          <span className="brand-mark" aria-hidden="true">M</span>
          État du service
        </h1>
        {status.isPending && <Spinner />}
        <ErrorMessage error={status.error} />
        {data && (
          <>
            <p className={data.operational ? 'status-ok' : 'status-ko'} role="status">
              {data.operational ? 'Tous les systèmes fonctionnent normalement.' : 'Un incident est en cours.'}
            </p>
            {data.active.map((i) => (
              <Incident key={i.id} incident={i} />
            ))}
            {data.recent.length > 0 && <h2>Incidents récents</h2>}
            {data.recent.map((i) => (
              <Incident key={i.id} incident={i} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
