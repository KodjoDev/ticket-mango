import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CustomField } from './api/types';
import { agent, makeTicket, mockApi, renderApp, testConfig } from './test/utils';

const fields: CustomField[] = [
  { id: 'f1', key: 'client_id', label: 'N° client', kind: 'TEXT', options: [], required: true, forRequester: true, position: 0, isActive: true },
  { id: 'f2', key: 'niveau', label: 'Niveau', kind: 'SELECT', options: ['bas', 'haut'], required: false, forRequester: false, position: 1, isActive: true },
];
const config = { ...testConfig, customFields: fields };

describe('champs personnalisés', () => {
  it('envoie les valeurs saisies à la création du ticket', async () => {
    const calls = mockApi({
      'GET /auth/me': agent,
      'GET /config': config,
      'GET /views': [],
      'GET /notifications': { items: [], unread: 0 },
      'GET /public/status': { operational: true, active: [], recent: [] },
      'POST /tickets': { status: 201, json: makeTicket({}) },
      'GET /tickets/42': makeTicket({}),
      'GET /tickets/42/comments': [],
      'GET /tickets/42/audit': [],
      'GET /agents': [],
    });
    renderApp('/tickets/new');
    await userEvent.type(await screen.findByLabelText(/Sujet/), 'Panne');
    await userEvent.type(screen.getByLabelText(/Description/), 'Détails');
    await userEvent.type(screen.getByLabelText('N° client'), 'C-42');
    await userEvent.selectOptions(screen.getByLabelText('Niveau'), 'haut');
    await userEvent.click(screen.getByRole('button', { name: 'Créer le ticket' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/tickets')).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/tickets')!;
    expect(post.body).toMatchObject({ customValues: { client_id: 'C-42', niveau: 'haut' } });
  });

  it('enregistre un champ modifié sur un ticket existant, à la fin de la saisie', async () => {
    const calls = mockApi({
      'GET /auth/me': agent,
      'GET /config': config,
      'GET /tickets/42': makeTicket({ customValues: { client_id: 'C-1' } }),
      'GET /tickets/42/comments': [],
      'GET /tickets/42/audit': [],
      'GET /agents': [],
      'PATCH /tickets/42': makeTicket({ customValues: { client_id: 'C-2' } }),
    });
    renderApp('/tickets/42');
    const input = await screen.findByLabelText('N° client');
    expect(input).toHaveValue('C-1');
    await userEvent.clear(input);
    await userEvent.type(input, 'C-2');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    await userEvent.tab();
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ customValues: { client_id: 'C-2' } }));
  });
});
