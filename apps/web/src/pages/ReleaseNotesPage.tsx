import { useQuery } from '@tanstack/react-query';
import { RELEASE_CATEGORY_LABELS } from '@ticketing/shared';
import { publicApi } from '../api/client';
import { ErrorMessage, formatDate, Spinner } from '../components/ui';

/** Portail public des nouveautés : lecture « clients », aucune connexion requise. */
export function ReleaseNotesPage() {
  const { data, error, isPending } = useQuery({ queryKey: ['public-releases'], queryFn: publicApi.releaseNotes });
  return (
    <div className="login">
      <div className="status-page">
        <h1>
          <span className="brand-mark" aria-hidden="true">M</span>
          Nouveautés
        </h1>
        {isPending && <Spinner />}
        <ErrorMessage error={error} />
        {data?.length === 0 && <p className="empty">Aucune version publiée pour le moment.</p>}
        {data?.map((r) => (
          <article key={r.id} className="card">
            <h2>
              Version {r.version}
              {r.title && ` — ${r.title}`}
            </h2>
            <p className="muted small">Publiée le {formatDate(r.publishedAt)}</p>
            {r.sections.map((s) => (
              <section key={s.category}>
                <h3 className="subhead">{RELEASE_CATEGORY_LABELS[s.category]}</h3>
                <ul>
                  {s.items.map((i, n) => (
                    <li key={n}>{i.text}</li>
                  ))}
                </ul>
              </section>
            ))}
          </article>
        ))}
      </div>
    </div>
  );
}
