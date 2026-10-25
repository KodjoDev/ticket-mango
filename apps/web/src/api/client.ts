import type { TicketStatus } from '@ticketing/shared';
import type { Agent, AuditEntry, Comment, Page, Ticket, TicketFilters, TicketInput, User } from './types';

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
};
