import { useQuery } from '@tanstack/react-query';
import { INCIDENT_STATUS_LABELS } from '@ticketing/shared';
import { Link } from 'react-router';
import { publicApi } from '../api/client';

/** Bandeau du portail : incidents majeurs en cours, visible de tous les utilisateurs connectés. */
export function IncidentBanner() {
  const { data } = useQuery({ queryKey: ['public-status'], queryFn: publicApi.status, refetchInterval: 60_000 });
  if (!data || data.active.length === 0) return null;
  return (
    <div className="incident-banner" role="alert">
      {data.active.map((i) => (
        <span key={i.id}>
          <strong>
            [{i.severity}] {i.title}
          </strong>{' '}
          — {INCIDENT_STATUS_LABELS[i.status]}
        </span>
      ))}
      <Link to="/status">Détails</Link>
    </div>
  );
}
