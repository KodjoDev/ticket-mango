import { isOpenStatus, TICKET_STATUSES, type Priority, type TicketStatus, type ViewFilters } from '@ticketing/shared';
import type { TicketFilters } from './api/types';

export const PAGE_SIZE = 25;
const OPEN_STATUSES = TICKET_STATUSES.filter(isOpenStatus);

const list = (value: string | null) => (value ? value.split(',').filter(Boolean) : undefined);

/**
 * Les filtres de la liste vivent dans l'URL : une vue filtrée se partage par simple lien.
 * - status : « open » (défaut), « all » ou liste de statuts séparés par des virgules
 * - assignee : « me », « none » ou identifiant d'agent
 */
export function filtersFromParams(params: URLSearchParams, userId: string): TicketFilters {
  const status = params.get('status') ?? 'open';
  const assignee = params.get('assignee');
  return {
    status: status === 'open' ? OPEN_STATUSES : status === 'all' ? undefined : (list(status) as TicketStatus[]),
    priority: list(params.get('priority')) as Priority[] | undefined,
    type: params.get('type') || undefined,
    component: params.get('component') || undefined,
    assigneeId: assignee === 'me' ? userId : assignee || undefined,
    tagId: params.get('tag') || undefined,
    q: params.get('q') || undefined,
    page: Number(params.get('page')) || 1,
    pageSize: PAGE_SIZE,
  };
}

/** Paramètres d'URL correspondant à une vue enregistrée. */
export function viewToParams(f: ViewFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set('status', f.status === undefined ? 'all' : f.status === 'open' ? 'open' : f.status.join(','));
  if (f.priority) params.set('priority', f.priority.join(','));
  if (f.type) params.set('type', f.type);
  if (f.component) params.set('component', f.component);
  if (f.assignee) params.set('assignee', f.assignee);
  if (f.tagId) params.set('tag', f.tagId);
  return params;
}

/** Vrai si l'URL courante affiche exactement cette vue (hors recherche et pagination). */
export function isViewActive(f: ViewFilters, params: URLSearchParams): boolean {
  const current = new URLSearchParams(params);
  current.delete('q');
  current.delete('page');
  if (!current.has('status')) current.set('status', 'open');
  const expected = viewToParams(f);
  current.sort();
  expected.sort();
  return current.toString() === expected.toString();
}
