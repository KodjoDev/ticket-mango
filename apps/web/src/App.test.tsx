import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toQueryString } from './api/client';
import { filtersFromParams } from './pages/TicketListPage';
import { agent, external, makeTicket, mockApi, renderApp } from './test/utils';

const page = (items = [makeTicket()]) => ({ items, total: items.length, page: 1, pageSize: 25 });

describe('authentification', () => {
  it('redirige vers la connexion puis revient sur la page demandée', async () => {
    let loggedIn = false;
    mockApi({
      'GET /auth/me': () => (loggedIn ? { json: agent } : { status: 401, json: { message: 'Authentification requise' } }),
      'POST /auth/login': () => {
        loggedIn = true;
        return { json: { user: agent } };
      },
      'GET /tickets': page(),
    });
    renderApp('/tickets');

    await userEvent.type(await screen.findByLabelText('Email'), 'agent@test.local');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByRole('link', { name: 'Erreur 500 au login' })).toBeInTheDocument();
    expect(screen.getByText('Alice Agent')).toBeInTheDocument();
  });

  it('affiche l’erreur renvoyée par l’API', async () => {
    mockApi({
      'GET /auth/me': () => ({ status: 401, json: {} }),
      'POST /auth/login': () => ({ status: 401, json: { message: 'Identifiants invalides' } }),
    });
    renderApp('/login');

    await userEvent.type(await screen.findByLabelText('Email'), 'agent@test.local');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'mauvais');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Identifiants invalides');
  });
});

describe('liste des tickets', () => {
  it('affiche les tickets ouverts par défaut et applique les filtres', async () => {
    const calls = mockApi({ 'GET /auth/me': agent, 'GET /tickets': page() });
    renderApp('/tickets');

    const row = (await screen.findByRole('link', { name: 'Erreur 500 au login' })).closest('tr')!;
    expect(within(row).getByText('P2')).toBeInTheDocument();
    expect(within(row).getByText('Nouveau / Non qualifié')).toBeInTheDocument();
    expect(calls.at(-1)!.search).toContain('status=NEW%2CQUALIFYING');

    await userEvent.selectOptions(screen.getByLabelText('Priorité'), 'P0');
    await waitFor(() => expect(calls.at(-1)!.search).toContain('priority=P0'));
  });

  it('propose « Assignés à moi » aux agents seulement', async () => {
    mockApi({ 'GET /auth/me': external, 'GET /tickets': page() });
    renderApp('/tickets');
    await screen.findByRole('link', { name: 'Erreur 500 au login' });
    expect(screen.queryByLabelText('Assignés à moi')).not.toBeInTheDocument();
  });

  it('traduit les paramètres d’URL en filtres d’API', () => {
    const filters = filtersFromParams(new URLSearchParams('status=all&mine=1&q=facture&page=3'), 'u1');
    expect(filters).toMatchObject({ status: undefined, assigneeId: 'u1', q: 'facture', page: 3 });
    expect(toQueryString({ status: ['NEW', 'IN_QA'], q: '', page: 2 })).toBe('?status=NEW%2CIN_QA&page=2');
  });
});

describe('détail d’un ticket', () => {
  const detailRoutes = (user = agent, ticket = makeTicket()) => ({
    'GET /auth/me': user,
    'GET /tickets/42': ticket,
    'GET /tickets/42/comments': [
      { id: 'c1', body: 'Piste : cache', isInternal: true, createdAt: ticket.createdAt, author: { id: agent.id, name: agent.name } },
    ],
    'GET /tickets/42/audit': [],
    'GET /agents': [{ id: agent.id, name: agent.name, role: agent.role }],
  });

  it('propose uniquement les transitions autorisées par le workflow', async () => {
    const calls = mockApi({
      ...detailRoutes(),
      'POST /tickets/42/status': (body) => ({ json: makeTicket({ status: (body as { status: 'QUALIFYING' }).status }) }),
    });
    renderApp('/tickets/42');

    expect(await screen.findByRole('button', { name: 'En cours de qualification' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Résoudre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clôturer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'En recette / Validation QA' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'En cours de qualification' }));
    await waitFor(() =>
      expect(calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/tickets/42/status', body: { status: 'QUALIFYING' } })),
    );
    expect(await screen.findByRole('button', { name: 'Transmis aux développeurs' })).toBeInTheDocument();
  });

  it('envoie la requalification et permet de s’assigner le ticket', async () => {
    const calls = mockApi({
      ...detailRoutes(),
      'PATCH /tickets/42': (body) => ({ json: makeTicket(body as object) }),
    });
    renderApp('/tickets/42');

    await userEvent.selectOptions(await screen.findByLabelText('Urgence'), 'CRITICAL');
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'PATCH', body: { urgency: 'CRITICAL' } })));

    await userEvent.click(screen.getByRole('button', { name: "M'assigner ce ticket" }));
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'PATCH', body: { assigneeId: agent.id } })));
  });

  it('masque les actions du support à l’utilisateur externe', async () => {
    mockApi({ ...detailRoutes(external), 'GET /tickets/42/comments': [] });
    renderApp('/tickets/42');

    expect(await screen.findByRole('heading', { name: /Erreur 500 au login/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clôturer' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Note interne')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Urgence')).toBeDisabled();
    expect(screen.queryByText('Historique')).not.toBeInTheDocument();
  });

  it('distingue visuellement les notes internes', async () => {
    mockApi(detailRoutes());
    renderApp('/tickets/42');
    const note = (await screen.findByText('Piste : cache')).closest('li')!;
    expect(note).toHaveClass('internal');
    expect(within(note).getByText('Note interne')).toBeInTheDocument();
  });
});
