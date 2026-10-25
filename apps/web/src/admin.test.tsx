import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from './api/types';
import { keyFromLabel } from './pages/admin/common';
import { agent, mockApi, renderApp, testConfig } from './test/utils';

const admin: User = { id: 'u-admin', email: 'admin@test.local', name: 'Ada Admin', role: 'ADMIN' };

describe('administration', () => {
  it('n’apparaît pas pour un agent et redirige un accès direct', async () => {
    mockApi({ 'GET /auth/me': agent, 'GET /tickets': { items: [], total: 0, page: 1, pageSize: 25 } });
    renderApp('/admin/tags');
    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
  });

  it('change le rôle d’un utilisateur, mais pas le sien', async () => {
    const calls = mockApi({
      'GET /auth/me': admin,
      'GET /users': [
        { ...admin, isActive: true, createdAt: '2026-10-01T00:00:00Z' },
        { ...agent, isActive: true, createdAt: '2026-10-02T00:00:00Z' },
      ],
      [`PATCH /users/${agent.id}`]: (body) => ({ json: { ...agent, ...(body as object), isActive: true, createdAt: '' } }),
    });
    renderApp('/admin/users');

    expect(await screen.findByLabelText('Rôle de Ada Admin')).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Rôle de Alice Agent'), 'AGENT_N2');
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'PATCH', body: { role: 'AGENT_N2' } })));
  });

  it('ajoute une valeur de liste avec un code dérivé du libellé', async () => {
    const calls = mockApi({ 'GET /auth/me': admin, 'POST /admin/options': () => ({ status: 201, json: {} }) });
    renderApp('/admin/qualification');

    await userEvent.click(await screen.findByRole('tab', { name: 'Modules' }));
    await userEvent.type(screen.getByLabelText('Libellé'), 'Application mobile');
    expect(screen.getByLabelText('Code (non modifiable ensuite)')).toHaveValue('APPLICATION_MOBILE');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ path: '/admin/options', body: { field: 'COMPONENT', key: 'APPLICATION_MOBILE', label: 'Application mobile' } }),
      ),
    );
  });

  it('ne propose ni archivage ni suppression pour une valeur système', async () => {
    mockApi({ 'GET /auth/me': admin });
    renderApp('/admin/qualification');
    const row = (await screen.findByDisplayValue('Bug / Incident technique')).closest('li')!;
    expect(within(row).getByText('Système')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Archiver' })).not.toBeInTheDocument();
  });

  it('réordonne les valeurs d’une liste', async () => {
    const calls = mockApi({ 'GET /auth/me': admin, 'PUT /admin/options/order': [] });
    renderApp('/admin/qualification');
    await userEvent.click(await screen.findByRole('button', { name: 'Descendre Bug / Incident technique' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'PUT', body: { field: 'TYPE', ids: ['TYPE-QUESTION', 'TYPE-BUG', 'TYPE-LEGACY'] } }),
      ),
    );
  });

  it('enregistre la matrice de priorité modifiée', async () => {
    const calls = mockApi({ 'GET /auth/me': admin, 'PUT /admin/priority-matrix': testConfig.priorityMatrix });
    renderApp('/admin/priority');
    const save = await screen.findByRole('button', { name: 'Enregistrer' });
    expect(save).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Individuel × Basse'), 'P3');
    await userEvent.click(save);
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT');
      expect((put?.body as typeof testConfig.priorityMatrix).INDIVIDUAL.LOW).toBe('P3');
    });
  });

  it('garde la colonne Sujet toujours visible', async () => {
    mockApi({ 'GET /auth/me': admin });
    renderApp('/admin/layout');
    expect(await screen.findByRole('checkbox', { name: 'Sujet' })).toBeDisabled();
  });

  it('dérive un code de liste valide', () => {
    expect(keyFromLabel('Équipe Paiement & Fraude')).toBe('EQUIPE_PAIEMENT_FRAUDE');
    expect(keyFromLabel('2FA')).toBe('K_2FA');
  });
});
