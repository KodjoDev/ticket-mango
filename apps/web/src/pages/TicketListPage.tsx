import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  LIST_COLUMN_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TICKET_STATUSES,
  type ListColumn,
} from '@ticketing/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import type { Ticket } from '../api/types';
import { useAuth, useCurrentUser } from '../auth/AuthContext';
import { TagList } from '../components/tags';
import { Avatar, ErrorMessage, formatDate, PriorityBadge, Spinner, StatusBadge } from '../components/ui';
import { useConfig, type ConfigHelpers } from '../config/ConfigContext';
import { filtersFromParams, PAGE_SIZE } from '../filters';

/** Contenu d'une cellule pour chaque colonne configurable. */
const CELLS: Record<ListColumn, (t: Ticket, config: ConfigHelpers) => ReactNode> = {
  id: (t) => <span className="muted">{t.id}</span>,
  subject: (t) => <Link to={`/tickets/${t.id}`}>{t.subject}</Link>,
  priority: (t) => <PriorityBadge priority={t.priority} />,
  status: (t) => <StatusBadge status={t.status} />,
  type: (t, c) => c.label('TYPE', t.type),
  component: (t, c) => c.label('COMPONENT', t.component),
  environment: (t, c) => c.label('ENVIRONMENT', t.environment),
  tags: (t) => <TagList tags={t.tags} />,
  requester: (t) => t.requester.name,
  assignee: (t) =>
    t.assignee ? (
      <span className="assignee-cell">
        <Avatar name={t.assignee.name} size="sm" />
        {t.assignee.name}
      </span>
    ) : (
      <span className="muted">Non assigné</span>
    ),
  createdAt: (t) => <span className="nowrap">{formatDate(t.createdAt)}</span>,
  updatedAt: (t) => <span className="nowrap">{formatDate(t.updatedAt)}</span>,
};

/** Valeur d'un sélecteur dont l'URL peut contenir plusieurs valeurs (ex. vue « P0 / P1 »). */
function single(value: string | null): string {
  return value && !value.includes(',') ? value : value ? '__multi' : '';
}

export function TicketListPage() {
  const user = useCurrentUser();
  const { can } = useAuth();
  const config = useConfig();
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params, user.id);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const columns = config.listColumns.filter((c) => c.visible).map((c) => c.key);

  const { data, error, isPending, isFetching } = useQuery({
    queryKey: ['tickets', filters],
    queryFn: () => api.tickets(filters),
    placeholderData: keepPreviousData,
  });

  function setParam(key: string, value: string | null) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: true },
    );
  }

  // Recherche appliquée 300 ms après la dernière frappe.
  useEffect(() => {
    if (search === (params.get('q') ?? '')) return;
    const timer = setTimeout(() => setParam('q', search.trim() || null), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const page = filters.page ?? 1;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const status = params.get('status') ?? 'open';

  return (
    <>
      <header className="page-header">
        <h1>{can('ticket:read:all') ? 'Tickets' : 'Mes demandes'}</h1>
        {can('ticket:create') && (
          <Link to="/tickets/new" className="button primary">
            Nouveau ticket
          </Link>
        )}
      </header>

      <div className="filters" role="search">
        <input
          type="search"
          placeholder="Rechercher dans le sujet ou la description"
          aria-label="Rechercher"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Statut" value={['open', 'all'].includes(status) ? status : single(status)} onChange={(e) => setParam('status', e.target.value)}>
          <option value="open">Ouverts</option>
          <option value="all">Tous les statuts</option>
          {status.includes(',') && (
            <option value="__multi" disabled>
              Plusieurs statuts
            </option>
          )}
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select aria-label="Priorité" value={single(params.get('priority'))} onChange={(e) => setParam('priority', e.target.value)}>
          <option value="">Toutes priorités</option>
          {params.get('priority')?.includes(',') && (
            <option value="__multi" disabled>
              {params.get('priority')!.replace(',', ' / ')}
            </option>
          )}
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select aria-label="Type" value={params.get('type') ?? ''} onChange={(e) => setParam('type', e.target.value)}>
          <option value="">Tous types</option>
          {config.choices('TYPE', params.get('type')).map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <select aria-label="Module" value={params.get('component') ?? ''} onChange={(e) => setParam('component', e.target.value)}>
          <option value="">Tous modules</option>
          {config.choices('COMPONENT', params.get('component')).map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        {config.tags.length > 0 && (
          <select aria-label="Tag" value={params.get('tag') ?? ''} onChange={(e) => setParam('tag', e.target.value)}>
            <option value="">Tous tags</option>
            {config.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {can('ticket:read:all') && (
          <select aria-label="Assignation" value={params.get('assignee') ?? ''} onChange={(e) => setParam('assignee', e.target.value)}>
            <option value="">Toutes assignations</option>
            <option value="me">Assignés à moi</option>
            <option value="none">Non assignés</option>
          </select>
        )}
      </div>

      <ErrorMessage error={error} />
      {isPending ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <p className="empty">Aucun ticket ne correspond à ces critères.</p>
      ) : (
        data && (
          <div className={`table-wrap${isFetching ? ' is-fetching' : ''}`}>
            <table className="tickets">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c}>{LIST_COLUMN_LABELS[c]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => (
                  <tr key={t.id}>
                    {columns.map((c) => (
                      <td key={c} className={c === 'subject' ? 'subject' : undefined}>
                        {CELLS[c](t, config)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {data && data.total > 0 && (
        <nav className="pagination" aria-label="Pagination">
          <span className="muted">
            {data.total} ticket{data.total > 1 ? 's' : ''} · page {page} / {pageCount}
          </span>
          <button type="button" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
            Précédent
          </button>
          <button type="button" disabled={page >= pageCount} onClick={() => setParam('page', String(page + 1))}>
            Suivant
          </button>
        </nav>
      )}
    </>
  );
}
