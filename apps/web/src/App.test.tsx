import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toQueryString } from './api/client';
import { filtersFromParams } from './filters';
import { agent, external, makeTicket, mockApi, renderApp, testConfig } from './test/utils';

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

  it('réserve le filtre d’assignation et les vues aux agents', async () => {
    mockApi({ 'GET /auth/me': external, 'GET /tickets': page() });
    renderApp('/tickets');
    await screen.findByRole('link', { name: 'Erreur 500 au login' });
    expect(screen.queryByLabelText('Assignation')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mes demandes' })).toBeInTheDocument();
  });

  it('affiche les vues avec leur nombre et applique leurs filtres', async () => {
    const calls = mockApi({
      'GET /auth/me': agent,
      'GET /tickets': page(),
      'GET /views': [
        { id: 'v1', name: 'Incidents P0 / P1', filters: { status: 'open', priority: ['P0', 'P1'] }, position: 0, count: 3 },
      ],
    });
    renderApp('/tickets');
    const link = await screen.findByRole('link', { name: /Incidents P0 \/ P1/ });
    expect(link).toHaveTextContent('3');
    await userEvent.click(link);
    await waitFor(() => expect(calls.at(-1)!.search).toContain('priority=P0%2CP1'));
    expect(link).toHaveClass('active');
  });

  it('suit l’ordre et la visibilité des colonnes définis par l’administrateur', async () => {
    mockApi({
      'GET /auth/me': agent,
      'GET /tickets': page([makeTicket({ tags: [{ id: 'tag-vip', name: 'VIP', color: '#cc3340' }] })]),
      'GET /config': {
        ...testConfig,
        listColumns: [
          { key: 'tags', visible: true },
          { key: 'subject', visible: true },
          ...testConfig.listColumns.filter((c) => !['tags', 'subject'].includes(c.key)).map((c) => ({ ...c, visible: false })),
        ],
      },
    });
    renderApp('/tickets');
    await screen.findByRole('link', { name: 'Erreur 500 au login' });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Tags', 'Sujet']);
    expect(within(screen.getByRole('table')).getByText('VIP')).toBeInTheDocument();
  });

  it('traduit les paramètres d’URL en filtres d’API', () => {
    const filters = filtersFromParams(new URLSearchParams('status=all&assignee=me&q=facture&page=3&tag=t1'), 'u1');
    expect(filters).toMatchObject({ status: undefined, assigneeId: 'u1', q: 'facture', page: 3, tagId: 't1' });
    expect(filtersFromParams(new URLSearchParams('status=NEW,IN_QA'), 'u1').status).toEqual(['NEW', 'IN_QA']);
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

  it('permet au support de changer le demandeur, y compris vers un nouveau contact', async () => {
    const paul = { id: 'u-paul', email: 'paul@client.local', name: 'Paul Martin', role: 'EXTERNAL_USER' };
    const calls = mockApi({
      ...detailRoutes(),
      'GET /requesters': (_body, url) => ({ json: url.searchParams.get('q') ? [] : [agent, external] }),
      'POST /requesters': () => ({ status: 201, json: paul }),
      'PATCH /tickets/42': () => ({ json: makeTicket({ requester: paul }) }),
    });
    renderApp('/tickets/42');

    await userEvent.click(await screen.findByRole('button', { name: 'Changer le demandeur' }));
    await userEvent.type(screen.getByLabelText('Rechercher un demandeur'), 'paul@client.local');
    await userEvent.type(await screen.findByLabelText('Nom du nouveau contact'), 'Paul Martin');
    await userEvent.click(screen.getByRole('button', { name: 'Créer le contact' }));

    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'PATCH', body: { requesterId: paul.id } })));
    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'POST', path: '/requesters', body: { email: 'paul@client.local', name: 'Paul Martin' } }),
    );
    expect(await screen.findByText('Paul Martin')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rechercher un demandeur')).not.toBeInTheDocument();
  });

  it('crée une issue depuis le ticket et affiche la version de correction', async () => {
    const link = {
      id: 'l1',
      externalKey: 'APP-12',
      url: 'https://acme.atlassian.net/browse/APP-12',
      title: 'Erreur 500',
      externalStatus: 'Done',
      fixVersion: 'v2.4.1',
      integration: { id: 'i1', name: 'Jira produit', provider: 'JIRA' as const },
    };
    let linked = false;
    const calls = mockApi({
      ...detailRoutes(),
      'GET /dev/integrations': [{ id: 'i1', name: 'Jira produit', provider: 'JIRA', project: 'APP' }],
      'GET /tickets/42': () => ({ json: makeTicket(linked ? { devLinks: [link], fixedInVersion: 'v2.4.1' } : {}) }),
      'POST /dev/tickets/42/links': () => {
        linked = true;
        return { status: 201, json: { externalKey: 'APP-12', url: link.url } };
      },
    });
    renderApp('/tickets/42');

    await userEvent.click(await screen.findByRole('button', { name: "Créer l'issue" }));
    await waitFor(() =>
      expect(calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/dev/tickets/42/links', body: { integrationId: 'i1' } })),
    );
    expect(await screen.findByRole('link', { name: 'APP-12' })).toHaveAttribute('href', link.url);
    expect(screen.getAllByText(/v2\.4\.1/).length).toBeGreaterThan(0);
  });

  it('masque les actions du support à l’utilisateur externe', async () => {
    mockApi({ ...detailRoutes(external), 'GET /tickets/42/comments': [] });
    renderApp('/tickets/42');

    expect(await screen.findByRole('heading', { name: /Erreur 500 au login/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clôturer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Note interne' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toBeDisabled();
    expect(screen.queryByLabelText('Urgence')).not.toBeInTheDocument();
    expect(screen.queryByText('Historique')).not.toBeInTheDocument();
  });

  it('envoie une note interne depuis l’onglet dédié', async () => {
    const calls = mockApi({
      ...detailRoutes(),
      'POST /tickets/42/comments': (body) => ({ status: 201, json: { id: 'c2', ...(body as object) } }),
    });
    renderApp('/tickets/42');

    await userEvent.click(await screen.findByRole('tab', { name: 'Note interne' }));
    await userEvent.type(screen.getByLabelText('Votre message'), 'À vérifier côté cache');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter la note' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'POST', body: { body: 'À vérifier côté cache', isInternal: true } }),
      ),
    );
  });

  it('propose les tags actifs et envoie la nouvelle liste', async () => {
    const calls = mockApi({ ...detailRoutes(), 'PATCH /tickets/42': () => ({ json: makeTicket() }) });
    renderApp('/tickets/42');
    const vip = await screen.findByRole('button', { name: 'VIP' });
    expect(screen.queryByRole('button', { name: 'Ancien' })).not.toBeInTheDocument();
    await userEvent.click(vip);
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'PATCH', body: { tagIds: ['tag-vip'] } })));
  });

  it('affiche une valeur archivée encore portée par le ticket sans la proposer ailleurs', async () => {
    mockApi(detailRoutes(agent, makeTicket({ type: 'LEGACY' })));
    renderApp('/tickets/42');
    const select = await screen.findByLabelText('Type');
    expect(select).toHaveDisplayValue('Ancien type (archivé)');
  });

  it('distingue visuellement les notes internes', async () => {
    mockApi(detailRoutes());
    renderApp('/tickets/42');
    const note = (await screen.findByText('Piste : cache')).closest('li')!;
    expect(note).toHaveClass('internal');
    expect(within(note).getByText('Note interne')).toBeInTheDocument();
  });
});

describe('création d’un ticket', () => {
  it('laisse l’agent saisir le ticket pour le compte d’un client', async () => {
    const calls = mockApi({
      'GET /auth/me': agent,
      'GET /requesters': [external],
      'POST /tickets': () => ({ status: 201, json: makeTicket() }),
      'GET /tickets/42': makeTicket(),
      'GET /tickets/42/comments': [],
      'GET /tickets/42/audit': [],
      'GET /agents': [],
    });
    renderApp('/tickets/new');

    expect(await screen.findByText('(vous)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Changer' }));
    await userEvent.click(await screen.findByRole('button', { name: /Charles Client/ }));
    await userEvent.type(screen.getByLabelText('Sujet'), 'Appel téléphonique');
    await userEvent.type(screen.getByLabelText('Description'), 'Le client ne peut plus se connecter.');
    await userEvent.click(screen.getByRole('button', { name: 'Créer le ticket' }));

    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'POST', path: '/tickets', body: expect.objectContaining({ requesterId: external.id }) }),
      ),
    );
  });
});
