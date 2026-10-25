import type {
  LayoutItem,
  ListColumn,
  OptionField,
  PriorityMatrix,
  Role,
  TicketFormField,
  TicketStatus,
  ViewFilters,
} from '@ticketing/shared';
import type {
  Agent,
  AppConfig,
  AuditEntry,
  Comment,
  FieldOption,
  ManagedUser,
  Page,
  Tag,
  Ticket,
  TicketFilters,
  TicketInput,
  User,
  View,
} from './types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Appelé sur toute réponse 401, pour renvoyer vers la connexion. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    // La session voyage dans un cookie httpOnly posé par l'API.
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    throw new ApiError(res.status, data?.message ?? `Erreur ${res.status}`, data?.issues);
  }
  return data as T;
}

export function toQueryString(filters: TicketFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  login: (email: string, password: string) => request<{ user: User }>('POST', '/auth/login', { email, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<User>('GET', '/auth/me'),

  agents: () => request<Agent[]>('GET', '/agents'),

  tickets: (filters: TicketFilters) => request<Page<Ticket>>('GET', `/tickets${toQueryString(filters)}`),
  ticket: (id: number) => request<Ticket>('GET', `/tickets/${id}`),
  createTicket: (input: TicketInput & { subject: string; description: string }) =>
    request<Ticket>('POST', '/tickets', input),
  updateTicket: (id: number, input: TicketInput) => request<Ticket>('PATCH', `/tickets/${id}`, input),
  transition: (id: number, status: TicketStatus) => request<Ticket>('POST', `/tickets/${id}/status`, { status }),

  comments: (id: number) => request<Comment[]>('GET', `/tickets/${id}/comments`),
  addComment: (id: number, body: string, isInternal: boolean) =>
    request<Comment>('POST', `/tickets/${id}/comments`, { body, isInternal }),

  audit: (id: number) => request<AuditEntry[]>('GET', `/tickets/${id}/audit`),

  config: () => request<AppConfig>('GET', '/config'),
  views: () => request<View[]>('GET', '/views'),
};

/** Routes d'administration (permissions user:manage et settings:manage). */
export const adminApi = {
  users: () => request<ManagedUser[]>('GET', '/users'),
  createUser: (input: { email: string; name: string; password: string; role: Role }) =>
    request<ManagedUser>('POST', '/users', input),
  updateUser: (id: string, input: Partial<{ name: string; role: Role; isActive: boolean; password: string }>) =>
    request<ManagedUser>('PATCH', `/users/${id}`, input),

  createOption: (input: { field: OptionField; key: string; label: string }) =>
    request<FieldOption>('POST', '/admin/options', input),
  updateOption: (id: string, input: Partial<{ label: string; isActive: boolean }>) =>
    request<FieldOption>('PATCH', `/admin/options/${id}`, input),
  reorderOptions: (field: OptionField, ids: string[]) => request<FieldOption[]>('PUT', '/admin/options/order', { field, ids }),
  deleteOption: (id: string) => request<void>('DELETE', `/admin/options/${id}`),

  savePriorityMatrix: (matrix: PriorityMatrix) => request<PriorityMatrix>('PUT', '/admin/priority-matrix', matrix),
  saveTicketForm: (layout: LayoutItem<TicketFormField>[]) => request('PUT', '/admin/layout/ticket-form', layout),
  saveListColumns: (layout: LayoutItem<ListColumn>[]) => request('PUT', '/admin/layout/list-columns', layout),

  createTag: (input: { name: string; color: string }) => request<Tag>('POST', '/admin/tags', input),
  updateTag: (id: string, input: Partial<{ name: string; color: string; isActive: boolean }>) =>
    request<Tag>('PATCH', `/admin/tags/${id}`, input),
  deleteTag: (id: string) => request<void>('DELETE', `/admin/tags/${id}`),

  createView: (input: { name: string; filters: ViewFilters }) => request<View>('POST', '/admin/views', input),
  updateView: (id: string, input: Partial<{ name: string; filters: ViewFilters }>) =>
    request<View>('PATCH', `/admin/views/${id}`, input),
  reorderViews: (ids: string[]) => request<View[]>('PUT', '/admin/views/order', { ids }),
  deleteView: (id: string) => request<void>('DELETE', `/admin/views/${id}`),
};
