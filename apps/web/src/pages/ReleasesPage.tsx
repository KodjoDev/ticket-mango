import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RELEASE_CATEGORIES, RELEASE_CATEGORY_LABELS, type ReleaseCategory } from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import type { ReleaseDetail } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage, Field, formatDate, Spinner } from '../components/ui';

function useReleaseMutation<T, V>(fn: (v: V) => Promise<T>, onSuccess?: (r: T) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['releases'] });
      void queryClient.invalidateQueries({ queryKey: ['public-releases'] });
      onSuccess?.(r);
    },
  });
}

export function ReleaseListPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ version: '', title: '' });
  const { data, error, isPending } = useQuery({ queryKey: ['releases', 'list'], queryFn: api.releases });
  const create = useReleaseMutation(() => api.createRelease({ version: f.version, title: f.title.trim() || null }), (r) => navigate(`/releases/${r.id}`));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(undefined);
  };
  return (
    <>
      <header className="page-header">
        <h1>Versions et release notes</h1>
        <Link to="/releases">Voir le portail public</Link>
      </header>
      {can('release:manage') && (
        <form className="card" onSubmit={submit}>
          <h2>Nouvelle version</h2>
          <ErrorMessage error={create.error} />
          <div className="grid-3">
            <Field label="Version">
              <input required maxLength={50} value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} placeholder="2.4.0" />
            </Field>
            <Field label="Titre (facultatif)">
              <input maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
          </div>
          <div className="actions">
            <button type="submit" className="primary" disabled={create.isPending}>
              Créer
            </button>
          </div>
        </form>
      )}
      <ErrorMessage error={error} />
      {isPending ? (
        <Spinner />
      ) : data?.length === 0 ? (
        <p className="empty">Aucune version.</p>
      ) : (
        <ul className="mailboxes">
          {data?.map((r) => (
            <li key={r.id} className="mailbox">
              <Link to={`/releases/${r.id}`}>Version {r.version}</Link>{' '}
              <span className="badge">{r.status === 'PUBLISHED' ? 'Publiée' : 'Brouillon'}</span>{' '}
              <span className="muted small">{r._count.items} ticket(s)</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ItemRow({ release, item, editable }: { release: ReleaseDetail; item: ReleaseDetail['items'][number]; editable: boolean }) {
  const [summary, setSummary] = useState(item.summary ?? '');
  const update = useReleaseMutation((input: { category?: ReleaseCategory; summary?: string | null }) => api.updateReleaseItem(release.id, item.ticketId, input));
  const remove = useReleaseMutation(() => api.removeReleaseTicket(release.id, item.ticketId));
  return (
    <li className="release-item">
      <div>
        <Link to={`/tickets/${item.ticketId}`}>#{item.ticketId}</Link> {item.ticket.subject}
        {item.ticket.devLinks.map((l) => (
          <span key={l.externalKey} className="muted small"> · {l.externalKey}</span>
        ))}
      </div>
      <ErrorMessage error={update.error ?? remove.error} />
      {editable ? (
        <div className="inline-form">
          <select aria-label={`Catégorie du ticket ${item.ticketId}`} value={item.category} onChange={(e) => update.mutate({ category: e.target.value as ReleaseCategory })}>
            {RELEASE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {RELEASE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <input
            aria-label={`Résumé clients du ticket ${item.ticketId}`}
            placeholder="Résumé pour les clients (laisser vide pour ne pas l’afficher)"
            maxLength={1000}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={() => summary.trim() !== (item.summary ?? '') && update.mutate({ summary: summary.trim() || null })}
          />
          <button type="button" className="link danger" onClick={() => remove.mutate(undefined)}>
            Retirer
          </button>
        </div>
      ) : (
        <p className="muted small">{item.summary || 'Pas de résumé clients'}</p>
      )}
    </li>
  );
}

function Candidates({ release }: { release: ReleaseDetail }) {
  const { data } = useQuery({ queryKey: ['releases', release.id, 'candidates', release.items.length], queryFn: () => api.releaseCandidates(release.id) });
  const add = useReleaseMutation((ids: number[]) => api.addReleaseTickets(release.id, ids));
  if (!data?.length) return <p className="muted small">Aucun ticket « prêt à livrer » ou « résolu » en attente de version.</p>;
  return (
    <>
      <ErrorMessage error={add.error} />
      <ul>
        {data.map((t) => (
          <li key={t.id}>
            <Link to={`/tickets/${t.id}`}>#{t.id}</Link> {t.subject} {t.matchesVersion && <span className="badge">Version de correction {release.version}</span>}{' '}
            <button type="button" className="link" onClick={() => add.mutate([t.id])}>
              Ajouter
            </button>
          </li>
        ))}
      </ul>
      {data.some((t) => t.matchesVersion) && (
        <button type="button" onClick={() => add.mutate(data.filter((t) => t.matchesVersion).map((t) => t.id))}>
          Ajouter tous ceux de la version {release.version}
        </button>
      )}
    </>
  );
}

export function ReleaseDetailPage() {
  const id = useParams().id ?? '';
  const { can } = useAuth();
  const navigate = useNavigate();
  const [notify, setNotify] = useState(true);
  const { data: release, error, isPending } = useQuery({ queryKey: ['releases', id], queryFn: () => api.release(id) });
  const publish = useReleaseMutation(() => api.publishRelease(id, notify));
  const notifyNow = useReleaseMutation(() => api.notifyRelease(id));
  const remove = useReleaseMutation(() => api.deleteRelease(id), () => navigate('/releases/manage'));
  if (isPending) return <Spinner />;
  if (!release) return <ErrorMessage error={error} />;
  const editable = can('release:manage') && release.status === 'DRAFT';
  const result = publish.data?.notification ?? notifyNow.data;
  return (
    <>
      <header className="page-header">
        <h1>
          Version {release.version}
          {release.title && ` — ${release.title}`}
        </h1>
        <span className="badge">{release.status === 'PUBLISHED' ? `Publiée le ${formatDate(release.publishedAt)}` : 'Brouillon'}</span>
      </header>
      <p className="muted small">
        <Link to="/releases/manage">← Toutes les versions</Link>
      </p>

      <section className="card">
        <h2>Notes techniques (interne)</h2>
        {release.notes.technical.length === 0 && <p className="muted small">Aucun ticket dans cette version.</p>}
        {release.notes.technical.map((s) => (
          <div key={s.category}>
            <h3 className="subhead">{RELEASE_CATEGORY_LABELS[s.category]}</h3>
            <ul>
              {s.items.map((i) => (
                <li key={i.ticketId}>
                  #{i.ticketId} {i.text}
                  {i.component && <span className="muted small"> ({i.component})</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Notes clients</h2>
        {release.notes.customer.length === 0 && <p className="muted small">Rédigez un résumé vulgarisé pour qu’un ticket apparaisse ici.</p>}
        {release.notes.customer.map((s) => (
          <div key={s.category}>
            <h3 className="subhead">{RELEASE_CATEGORY_LABELS[s.category]}</h3>
            <ul>
              {s.items.map((i, n) => (
                <li key={n}>{i.text}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Tickets de la version</h2>
        <ul className="release-items">
          {release.items.map((item) => (
            <ItemRow key={item.ticketId} release={release} item={item} editable={editable} />
          ))}
        </ul>
        {editable && (
          <>
            <h3 className="subhead">Tickets à ajouter</h3>
            <Candidates release={release} />
          </>
        )}
      </section>

      {can('release:manage') && (
        <section className="card">
          <ErrorMessage error={publish.error ?? notifyNow.error ?? remove.error} />
          {result && (
            <p role="status">
              {result.delivered
                ? `${result.sent} demandeur(s) prévenu(s) par e-mail, ${result.failed} en échec.`
                : `SMTP non configuré : ${result.sent} message(s) journalisé(s), aucun envoyé.`}
            </p>
          )}
          {release.status === 'DRAFT' ? (
            <div className="actions">
              <label className="checkbox">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                Prévenir par e-mail les demandeurs des tickets livrés
              </label>
              <button type="button" onClick={() => window.confirm('Supprimer ce brouillon ?') && remove.mutate(undefined)}>
                Supprimer
              </button>
              <button type="button" className="primary" disabled={publish.isPending || release.items.length === 0} onClick={() => publish.mutate(undefined)}>
                Publier sur le portail
              </button>
            </div>
          ) : release.notifiedCount === null ? (
            <div className="actions">
              <button type="button" className="primary" disabled={notifyNow.isPending} onClick={() => notifyNow.mutate(undefined)}>
                Prévenir les demandeurs
              </button>
            </div>
          ) : (
            <p className="muted small">{release.notifiedCount} demandeur(s) prévenu(s).</p>
          )}
        </section>
      )}
    </>
  );
}
