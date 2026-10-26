import { screen, within } from '@testing-library/react';
import { DEFAULT_TICKET_PAGE } from '@ticketing/shared';
import { agent, makeTicket, mockApi, testConfig } from './test/utils';
import { renderApp } from './test/utils';

const routes = (ticketPage = DEFAULT_TICKET_PAGE) => ({
  'GET /auth/me': agent,
  'GET /config': { ...testConfig, ticketPage },
  'GET /tickets/42': makeTicket({}),
  'GET /tickets/42/comments': [],
  'GET /tickets/42/audit': [],
  'GET /tickets/42/meetings': [],
  'GET /agents': [],
  'GET /tickets/42/requester-history': {
    total: 3,
    items: [{ id: 7, subject: 'Ancienne panne', status: 'RESOLVED', priority: 'P2', createdAt: '2026-09-01T09:00:00Z' }],
  },
});

describe('page du ticket', () => {
  it('affiche l’historique des autres tickets du demandeur', async () => {
    mockApi(routes());
    renderApp('/tickets/42');
    expect(await screen.findByText('Ancienne panne')).toBeInTheDocument();
    expect(screen.getByText('2 ticket(s) plus ancien(s) non affiché(s).')).toBeInTheDocument();
  });

  it('range les blocs selon la disposition : colonne et visibilité', async () => {
    const layout = DEFAULT_TICKET_PAGE.map((i) =>
      i.key === 'sla' ? { ...i, column: 'main' as const } : i.key === 'dates' ? { ...i, visible: false } : i,
    );
    mockApi(routes(layout));
    const { container } = renderApp('/tickets/42');
    await screen.findByText('Ancienne panne');
    const main = container.querySelector('.ticket-main') as HTMLElement;
    const side = container.querySelector('.ticket-side') as HTMLElement;
    expect(within(main).queryByRole('heading', { name: 'Description' })).toBeInTheDocument();
    expect(within(side).queryByRole('heading', { name: 'Demandeur' })).toBeInTheDocument();
    expect(within(side).queryByRole('heading', { name: 'Dates' })).not.toBeInTheDocument();
    expect(within(main).queryByRole('heading', { name: 'Dates' })).not.toBeInTheDocument();
  });

  it('passe en une colonne quand le panneau de gauche est vide', async () => {
    mockApi(routes(DEFAULT_TICKET_PAGE.map((i) => ({ ...i, column: 'main' as const }))));
    const { container } = renderApp('/tickets/42');
    await screen.findByText('Ancienne panne');
    expect(container.querySelector('.ticket-side')).toBeNull();
    expect(container.querySelector('.ticket-layout.no-side')).not.toBeNull();
  });
});
