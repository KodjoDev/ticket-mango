import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from './api/types';
import { humanMinutes } from './components/Sla';
import { agent, external, makeTicket, mockApi, renderApp, slaDto } from './test/utils';

const admin: User = { id: 'u-admin', email: 'admin@test.local', name: 'Ada Admin', role: 'ADMIN' };
const page = (items = [makeTicket()]) => ({ items, total: items.length, page: 1, pageSize: 25 });
const detailRoutes = (user = agent, ticket = makeTicket()) => ({
  'GET /auth/me': user,
  'GET /tickets/42': ticket,
  'GET /tickets/42/comments': [],
  'GET /tickets/42/audit': [],
  'GET /agents': [
    { id: 'u-other', name: 'Bruno Autre', role: 'AGENT_N1' },
    { id: agent.id, name: agent.name, role: agent.role },
  ],
});

describe('liste : SLA, réponse client, référent', () => {
  it('affiche le délai le plus pressant et signale la réponse client en attente', async () => {
    const created = new Date(Date.now() - 50 * 60_000).toISOString();
    const breached = makeTicket({
      id: 7,
      subject: 'En retard',
      sla: { ...slaDto(created), calendar: 'ALWAYS', state: 'BREACHED', firstResponse: { state: 'BREACHED', targetMinutes: 15, elapsedMinutes: 50, remainingMinutes: -35, dueAt: null }, resolution: { state: 'OK', targetMinutes: 120, elapsedMinutes: 50, remainingMinutes: 70, dueAt: new Date(Date.now() + 70 * 60_000).toISOString() } },
      awaitingAgent: true,
      lastRequesterReplyAt: created,
      childCount: 2,
    });
    mockApi({ 'GET /auth/me': agent, 'GET /tickets': page([breached]) });
    renderApp('/tickets');

    const row = (await screen.findByRole('link', { name: 'En retard' })).closest('tr')!;
    expect(row).toHaveClass('awaiting');
    expect(within(row).getByText('Réponse client en attente')).toBeInTheDocument();
    expect(within(row).getByText('Référent · 2 lié(s)')).toBeInTheDocument();
    const sla = within(row).getByText(/35 min/).closest('.badge')!;
    expect(sla).toHaveClass('sla-breached');
    expect(sla).toHaveTextContent('1re rép.');
  });

  it('filtre par SLA, groupe et réponse client', async () => {
    const calls = mockApi({ 'GET /auth/me': agent, 'GET /tickets': page() });
    renderApp('/tickets');
    await screen.findByRole('link', { name: 'Erreur 500 au login' });

    await userEvent.selectOptions(screen.getByLabelText('SLA'), 'WARNING,BREACHED');
    await waitFor(() => expect(calls.at(-1)!.search).toContain('slaState=WARNING%2CBREACHED'));
    expect(calls.at(-1)!.search).toContain('sort=sla');
    await userEvent.selectOptions(screen.getByLabelText('Groupe'), 'mine');
    await waitFor(() => expect(calls.at(-1)!.search).toContain('groupId=mine'));
    await userEvent.click(screen.getByLabelText('Réponse client en attente'));
    await waitFor(() => expect(calls.at(-1)!.search).toContain('awaitingAgent=true'));
  });

  it('formate les durées restantes', () => {
    expect(humanMinutes(95)).toBe('1 h 35');
    expect(humanMinutes(3000)).toBe('2 j 2 h');
    expect(humanMinutes(-5)).toBe('0 min');
  });
});

describe('ticket : SLA, groupe, référent', () => {
  it('montre les deux délais SLA au support', async () => {
    mockApi(detailRoutes());
    renderApp('/tickets/42');
    const card = (await screen.findByRole('heading', { name: /SLA/ })).closest('section')!;
    expect(within(card).getByText('Première réponse')).toBeInTheDocument();
    expect(within(card).getByText('Résolution')).toBeInTheDocument();
    expect(within(card).getByText(/Heures ouvrées/)).toBeInTheDocument();
  });

  it('cache le SLA au demandeur', async () => {
    mockApi(detailRoutes(external));
    renderApp('/tickets/42');
    await screen.findByRole('heading', { name: /Erreur 500 au login/ });
    expect(screen.queryByRole('heading', { name: /^SLA/ })).not.toBeInTheDocument();
  });

  it('change de groupe, propose ses membres en premier et relance le routage', async () => {
    const calls = mockApi({
      ...detailRoutes(),
      'PATCH /tickets/42': (body) => ({ json: makeTicket(body as object) }),
      'POST /tickets/42/route': () => ({ json: makeTicket() }),
    });
    renderApp('/tickets/42');
    const agentSelect = await screen.findByLabelText('Agent assigné');
    const optionLabels = within(agentSelect).getAllByRole('option').map((o) => o.textContent);
    expect(optionLabels.slice(0, 2)).toEqual(['Non assigné', 'Alice Agent (groupe)']);

    await userEvent.selectOptions(screen.getByLabelText('Groupe'), 'g-n2');
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'PATCH', body: { groupId: 'g-n2' } })));
    await userEvent.click(screen.getByRole('button', { name: 'Relancer le routage' }));
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/tickets/42/route' })));
  });

  it('rattache le ticket à un référent par son numéro', async () => {
    const calls = mockApi({
      ...detailRoutes(),
      'PUT /tickets/42/parent': () => ({ json: makeTicket({ parent: { id: 7, subject: 'Panne générale', status: 'IN_PROGRESS' } }) }),
    });
    renderApp('/tickets/42');
    await userEvent.type(await screen.findByLabelText('Numéro du ticket référent'), '#7');
    await userEvent.click(screen.getByRole('button', { name: 'Rattacher' }));
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'PUT', body: { parentId: 7 } })));
    expect(await screen.findByRole('link', { name: '#7 Panne générale' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Détacher' })).toBeInTheDocument();
  });

  it('liste les tickets rattachés sur un référent', async () => {
    mockApi(
      detailRoutes(
        agent,
        makeTicket({
          childCount: 1,
          children: [{ id: 8, subject: 'Même panne', status: 'NEW', priority: 'P3', requester: { id: 'u-x', name: 'Marc' } }],
        }),
      ),
    );
    renderApp('/tickets/42');
    expect(await screen.findByRole('link', { name: '#8 Même panne' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Numéro du ticket référent')).not.toBeInTheDocument();
  });
});

describe('notifications', () => {
  it('affiche le nombre non lu et ouvre le ticket en marquant la notification lue', async () => {
    const calls = mockApi({
      ...detailRoutes(),
      'GET /tickets': page(),
      'GET /notifications': {
        unread: 1,
        items: [{ id: 'n1', ticketId: 42, kind: 'sla.breached', message: 'SLA de résolution dépassé sur le ticket #42', readAt: null, createdAt: '2026-10-25T10:00:00Z' }],
      },
      'POST /notifications/n1/read': () => ({ status: 204 }),
    });
    renderApp('/tickets');
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications (1 non lues)' }));
    await userEvent.click(screen.getByRole('button', { name: /SLA de résolution dépassé/ }));
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/notifications/n1/read' })));
    expect(await screen.findByRole('heading', { name: /Erreur 500 au login/ })).toBeInTheDocument();
  });
});

describe('administration du routage et des SLA', () => {
  it('crée une règle avec ses conditions', async () => {
    const calls = mockApi({
      'GET /auth/me': admin,
      'GET /admin/routing-rules': [],
      'POST /admin/routing-rules': () => ({ status: 201, json: {} }),
    });
    renderApp('/admin/routing');
    expect(await screen.findByText(/Aucune règle par défaut active/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle règle' }));
    await userEvent.type(screen.getByLabelText('Nom'), 'Facturation');
    await userEvent.selectOptions(screen.getByLabelText('Router vers le groupe'), 'g-n2');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Facturation' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'P1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ path: '/admin/routing-rules', body: { name: 'Facturation', groupId: 'g-n2', conditions: { component: ['BILLING'], priority: ['P1'] } } }),
      ),
    );
  });

  it('modifie un objectif SLA et enregistre la politique', async () => {
    const calls = mockApi({ 'GET /auth/me': admin, 'PUT /admin/sla-policy': () => ({ json: {} }) });
    renderApp('/admin/sla');
    const save = await screen.findByRole('button', { name: 'Enregistrer' });
    expect(save).toBeDisabled();
    const hours = screen.getByLabelText('Résolution P2 (heures)');
    await userEvent.clear(hours);
    await userEvent.type(hours, '6');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Samedi' }));
    await userEvent.click(save);
    await waitFor(() => {
      const body = calls.find((c) => c.method === 'PUT')?.body as { targets: { P2: { resolutionMinutes: number } }; businessHours: { week: unknown[] } };
      expect(body.targets.P2.resolutionMinutes).toBe(360);
      expect(body.businessHours.week[5]).toEqual({ start: '08:00', end: '18:00' });
    });
  });
});
