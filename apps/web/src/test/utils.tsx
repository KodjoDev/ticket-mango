import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes, createQueryClient } from '../App';
import { computeSla, DEFAULT_LIST_COLUMNS, DEFAULT_PRIORITY_MATRIX, DEFAULT_SLA_POLICY, DEFAULT_TICKET_FORM } from '@ticketing/shared';
import type { AppConfig, FieldOption, SlaStatusDto, TicketDetail, User } from '../api/types';
import { AuthProvider } from '../auth/AuthContext';

type Handler = (body: unknown, url: URL) => { status?: number; json?: unknown };

const option = (field: FieldOption['field'], key: string, label: string, position: number, extra: Partial<FieldOption> = {}) => ({
  id: `${field}-${key}`,
  field,
  key,
  label,
  position,
  isActive: true,
  isSystem: false,
  ...extra,
});

export const testConfig: AppConfig = {
  options: [
    option('TYPE', 'BUG', 'Bug / Incident technique', 0, { isSystem: true }),
    option('TYPE', 'QUESTION', 'Question / Assistance', 1, { isSystem: true }),
    option('TYPE', 'LEGACY', 'Ancien type', 2, { isActive: false }),
    option('COMPONENT', 'AUTH', 'Authentification', 0),
    option('COMPONENT', 'BILLING', 'Facturation', 1),
    option('ENVIRONMENT', 'PRODUCTION', 'Production', 0),
  ],
  tags: [
    { id: 'tag-vip', name: 'VIP', color: '#cc3340', isActive: true },
    { id: 'tag-old', name: 'Ancien', color: '#5c6970', isActive: false },
  ],
  priorityMatrix: DEFAULT_PRIORITY_MATRIX,
  ticketForm: DEFAULT_TICKET_FORM,
  listColumns: DEFAULT_LIST_COLUMNS,
  slaPolicy: DEFAULT_SLA_POLICY,
  groups: [
    { id: 'g-n1', name: 'Support N1', isActive: true, memberIds: ['u-agent'] },
    { id: 'g-n2', name: 'Support N2', isActive: true, memberIds: [] },
  ],
  features: { spellcheck: true, meetingProvider: 'demo' },
};

/** Réponses communes à toutes les pages authentifiées ; chaque test peut les surcharger. */
const DEFAULT_ROUTES: Record<string, object> = {
  'GET /config': testConfig,
  'GET /views': [],
  'GET /macros': [],
  'GET /tickets/42/meetings': [],
  'GET /notifications': { items: [], unread: 0 },
};

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
      // Formulaire (pièces jointes) : champs texte et noms des fichiers, pour les vérifications.
      const body =
        init.body instanceof FormData
          ? Object.fromEntries(
              [...new Set(init.body.keys())].map((k) => {
                const values = (init.body as FormData).getAll(k).map((v) => (typeof v === 'string' ? v : (v as File).name));
                return [k, values.length > 1 ? values : values[0]];
              }),
            )
          : init.body
            ? JSON.parse(String(init.body))
            : undefined;
      calls.push({ method, path, search: url.search, body });
      const route = routes[`${method} ${path}`] ?? DEFAULT_ROUTES[`${method} ${path}`];
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

/** État SLA sérialisé comme le renvoie l'API (dates en chaînes). */
export function slaDto(createdAt: string, now = createdAt): SlaStatusDto {
  return JSON.parse(
    JSON.stringify(
      computeSla({ priority: 'P2', createdAt: new Date(createdAt), firstResponseAt: null, resolvedAt: null, pauses: [], now: new Date(now) }),
    ),
  );
}

export function makeTicket(overrides: Partial<TicketDetail> = {}): TicketDetail {
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
    group: { id: 'g-n1', name: 'Support N1' },
    tags: [],
    sla: slaDto('2026-10-20T08:00:00.000Z'),
    slaState: 'OK',
    slaDueAt: null,
    parent: null,
    channel: 'WEB',
    mailboxId: null,
    mergedInto: null,
    attachments: [],
    childCount: 0,
    children: [],
    awaitingAgent: false,
    lastRequesterReplyAt: null,
    lastAgentReplyAt: null,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
    ...overrides,
  };
}
