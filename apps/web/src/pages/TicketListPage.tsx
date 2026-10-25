import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  COMPONENT_LABELS,
  COMPONENTS,
  isOpenStatus,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TICKET_STATUSES,
  TICKET_TYPE_LABELS,
  TICKET_TYPES,
  type Component,
  type Priority,
  type TicketStatus,
  type TicketType,
} from '@ticketing/shared';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import type { TicketFilters } from '../api/types';
import { useAuth, useCurrentUser } from '../auth/AuthContext';
import { ErrorMessage, formatDate, options, PriorityBadge, Spinner, StatusBadge } from '../components/ui';

const PAGE_SIZE = 25;
const OPEN_STATUSES = TICKET_STATUSES.filter(isOpenStatus);

/** Les filtres vivent dans l'URL : une vue filtrée se partage par simple lien. */
export function filtersFromParams(params: URLSearchParams, userId: string): TicketFilters {
  const status = params.get('status') ?? 'open';
  return {
    status: status === 'open' ? OPEN_STATUSES : status === 'all' ? undefined : [status as TicketStatus],
    priority: params.get('priority') ? [params.get('priority') as Priority] : undefined,
    type: (params.get('type') as TicketType) || undefined,
    component: (params.get('component') as Component) || undefined,
    assigneeId: params.get('mine') === '1' ? userId : undefined,
    q: params.get('q') || undefined,
    page: Number(params.get('page')) || 1,
    pageSize: PAGE_SIZE,
  };
}

export function TicketListPage() {
  const user = useCurrentUser();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params, user.id);
  const [search, setSearch] = useState(params.get('q') ?? '');

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

  return (
    <>
      <header className="page-header">
        <h1>Tickets</h1>
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
        <select aria-label="Statut" value={params.get('status') ?? 'open'} onChange={(e) => setParam('status', e.target.value)}>
          <option value="open">Ouverts</option>
          <option value="all">Tous les statuts</option>
          {options(TICKET_STATUSES, STATUS_LABELS)}
        </select>
        <select aria-label="Priorité" value={params.get('priority') ?? ''} onChange={(e) => setParam('priority', e.target.value)}>
          <option value="">Toutes priorités</option>
          {options(PRIORITIES, PRIORITY_LABELS)}
        </select>
        <select aria-label="Type" value={params.get('type') ?? ''} onChange={(e) => setParam('type', e.target.value)}>
          <option value="">Tous types</option>
          {options(TICKET_TYPES, TICKET_TYPE_LABELS)}
        </select>
        <select
          aria-label="Module"
          value={params.get('component') ?? ''}
          onChange={(e) => setParam('component', e.target.value)}
        >
          <option value="">Tous modules</option>
          {options(COMPONENTS, COMPONENT_LABELS)}
        </select>
        {can('ticket:transition') && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={params.get('mine') === '1'}
              onChange={(e) => setParam('mine', e.target.checked ? '1' : null)}
            />
            Assignés à moi
          </label>
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
                  <th>#</th>
                  <th>Sujet</th>
                  <th>Priorité</th>
                  <th>Statut</th>
                  <th>Type</th>
                  <th>Module</th>
                  <th>Assigné</th>
                  <th>Créé le</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => (
                  <tr key={t.id}>
                    <td className="muted">{t.id}</td>
                    <td className="subject">
                      <Link to={`/tickets/${t.id}`}>{t.subject}</Link>
                      <div className="muted small">{t.requester.name}</div>
                    </td>
                    <td>
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                    <td>{TICKET_TYPE_LABELS[t.type]}</td>
                    <td>{t.component ? COMPONENT_LABELS[t.component] : '—'}</td>
                    <td>{t.assignee?.name ?? <span className="muted">Non assigné</span>}</td>
                    <td className="nowrap">{formatDate(t.createdAt)}</td>
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
