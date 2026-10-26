import { screen } from '@testing-library/react';
import type { PublicStatus } from './api/types';
import { agent, mockApi, renderApp } from './test/utils';

const incident = {
  id: 'i1',
  title: 'API indisponible',
  severity: 'P0' as const,
  status: 'FIXING' as const,
  startedAt: '2026-10-26T09:00:00Z',
  resolvedAt: null,
  updates: [
    { status: 'FIXING' as const, message: 'Un correctif est en cours de déploiement.', createdAt: '2026-10-26T09:30:00Z' },
    { status: 'INVESTIGATING' as const, message: 'Nous enquêtons.', createdAt: '2026-10-26T09:00:00Z' },
  ],
};

describe('crise P0/P1', () => {
  it('affiche la status page publique sans session', async () => {
    mockApi({ 'GET /public/status': { operational: false, active: [incident], recent: [] } satisfies PublicStatus });
    renderApp('/status');
    expect(await screen.findByText('Un incident est en cours.')).toBeInTheDocument();
    expect(screen.getByText('API indisponible')).toBeInTheDocument();
    expect(screen.getByText('Un correctif est en cours de déploiement.')).toBeInTheDocument();
    expect(screen.getByText('Nous enquêtons.')).toBeInTheDocument();
  });

  it('annonce le fonctionnement normal quand aucun incident n’est actif', async () => {
    mockApi({ 'GET /public/status': { operational: true, active: [], recent: [] } satisfies PublicStatus });
    renderApp('/status');
    expect(await screen.findByText('Tous les systèmes fonctionnent normalement.')).toBeInTheDocument();
  });

  it('affiche un bandeau aux utilisateurs connectés pendant un incident', async () => {
    mockApi({
      'GET /auth/me': agent,
      'GET /views': [],
      'GET /notifications': { items: [], unread: 0 },
      'GET /public/status': { operational: false, active: [incident], recent: [] } satisfies PublicStatus,
      'GET /tickets': { items: [], total: 0, page: 1, pageSize: 25 },
    });
    renderApp('/incidents');
    expect(await screen.findByRole('alert')).toHaveTextContent('[P0] API indisponible');
  });
});
