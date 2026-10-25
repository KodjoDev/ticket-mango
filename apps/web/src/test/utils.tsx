import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes, createQueryClient } from '../App';
import type { Ticket, User } from '../api/types';
import { AuthProvider } from '../auth/AuthContext';

type Handler = (body: unknown, url: URL) => { status?: number; json?: unknown };

/**
 * Remplace fetch par une table de routes « MÉTHODE /chemin ».
 * Renvoie la liste des appels pour vérifier ce que l'interface a envoyé.
 */
export function mockApi(routes: Record<string, Handler | object>) {
  const calls: { method: string; path: string; search: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://localhost');
      const method = init.method ?? 'GET';
      const path = url.pathname.replace(/^\/api/, '');
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, search: url.search, body });
      const route = routes[`${method} ${path}`];
      if (!route) return new Response(JSON.stringify({ message: 'Introuvable' }), { status: 404 });
      const { status = 200, json } = typeof route === 'function' ? (route as Handler)(body, url) : { json: route };
      return new Response(status === 204 ? null : JSON.stringify(json), { status });
    }),
  );
  return calls;
}

export function renderApp(path: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

export const agent: User = { id: 'u-agent', email: 'agent@test.local', name: 'Alice Agent', role: 'AGENT_N1' };
export const external: User = { id: 'u-ext', email: 'client@test.local', name: 'Charles Client', role: 'EXTERNAL_USER' };

export function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 42,
    subject: 'Erreur 500 au login',
    description: 'Impossible de se connecter.',
    type: 'BUG',
    component: 'AUTH',
    environment: 'PRODUCTION',
    impact: 'TEAM',
    urgency: 'HIGH',
    priority: 'P2',
    priorityOverridden: false,
    status: 'NEW',
    requester: { id: external.id, name: external.name, email: external.email },
    assignee: null,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
    ...overrides,
  };
}
