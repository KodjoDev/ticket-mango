import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Comment, Mailbox, User } from './api/types';
import { humanSize } from './components/Attachments';
import { agent, external, makeTicket, mockApi, renderApp } from './test/utils';

const admin: User = { id: 'u-admin', email: 'admin@test.local', name: 'Ada Admin', role: 'ADMIN' };

const comment = (over: Partial<Comment>): Comment => ({
  id: 'c1',
  body: 'Voici les logs.',
  isInternal: false,
  channel: 'EMAIL',
  createdAt: '2026-10-26T09:00:00Z',
  author: { id: 'u-ext', name: 'Charles Client' },
  attachments: [{ id: 'a1', filename: 'server.log', contentType: 'text/plain', size: 2048, createdAt: '2026-10-26T09:00:00Z' }],
  ...over,
});

const ticketRoutes = (user: User, extra: object = {}) => ({
  'GET /auth/me': user,
  'GET /tickets/42': makeTicket({ channel: 'EMAIL' }),
  'GET /tickets/42/comments': [
    comment({}),
    comment({
      id: 'c2',
      body: 'Merci, nous regardons.',
      channel: 'WEB',
      author: { id: agent.id, name: agent.name },
      attachments: [],
      outbound: [{ status: 'SENT', toAddress: 'charles@client.fr', sentAt: '2026-10-26T09:05:00Z', lastError: null }],
    }),
  ],
  'GET /tickets/42/audit': [],
  'GET /agents': [],
  ...extra,
});

describe('tickets reçus par e-mail', () => {
  it('signale le canal, les pièces jointes et l’envoi des réponses', async () => {
    mockApi(ticketRoutes(agent));
    renderApp('/tickets/42');
    const first = (await screen.findByText('Voici les logs.')).closest('li')!;
    expect(within(first).getByText('par e-mail')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: /server\.log/ })).toHaveAttribute('href', '/api/attachments/a1');
    expect(within(first).getByText('2 Ko')).toBeInTheDocument();
    expect(screen.getByText('✓ envoyé à charles@client.fr')).toBeInTheDocument();
    expect(screen.getByText('✉ E-mail')).toBeInTheDocument();
  });

  it('envoie une réponse avec pièce jointe en multipart', async () => {
    const calls = mockApi({ ...ticketRoutes(agent), 'POST /tickets/42/comments': () => ({ status: 201, json: comment({}) }) });
    renderApp('/tickets/42');
    await userEvent.type(await screen.findByLabelText('Votre message'), 'Correctif joint');
    const input = screen.getAllByLabelText('Joindre des fichiers').at(-1)!;
    await userEvent.upload(input, new File(['patch'], 'fix.patch', { type: 'text/x-diff' }));
    expect(screen.getByText('fix.patch')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'POST', path: '/tickets/42/comments', body: { body: 'Correctif joint', isInternal: 'false', file: 'fix.patch' } }),
      ),
    );
  });

  it('refuse un fichier de plus de 25 Mo', async () => {
    mockApi(ticketRoutes(agent));
    renderApp('/tickets/42');
    await screen.findByLabelText('Votre message');
    const big = new File(['x'], 'enorme.zip');
    Object.defineProperty(big, 'size', { value: 30 * 1024 * 1024 });
    fireEvent.change(screen.getAllByLabelText('Joindre des fichiers').at(-1)!, { target: { files: [big] } });
    expect(await screen.findByText(/Trop volumineux \(25 Mo maximum\) : enorme\.zip/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retirer enorme.zip' })).not.toBeInTheDocument();
  });

  it('cache l’état d’envoi au demandeur', async () => {
    mockApi(ticketRoutes(external, { 'GET /tickets/42/comments': [comment({ outbound: undefined })] }));
    renderApp('/tickets/42');
    await screen.findByText('Voici les logs.');
    expect(screen.queryByText(/envoyé à/)).not.toBeInTheDocument();
  });

  it('formate les tailles de fichier', () => {
    expect(humanSize(512)).toBe('512 o');
    expect(humanSize(5 * 1024 * 1024 + 300_000)).toBe('5,3 Mo');
  });
});

describe('fusion de doublons', () => {
  it('fusionne dans le ticket indiqué après confirmation et y bascule', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = mockApi({
      ...ticketRoutes(agent),
      'POST /tickets/42/merge': () => ({ json: makeTicket({ id: 7, subject: 'Panne générale' }) }),
      'GET /tickets/7': makeTicket({ id: 7, subject: 'Panne générale' }),
      'GET /tickets/7/comments': [],
      'GET /tickets/7/audit': [],
      'GET /tickets/7/meetings': [],
    });
    renderApp('/tickets/42');
    await userEvent.type(await screen.findByLabelText('Numéro du ticket à conserver'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Fusionner' }));
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/tickets/42/merge', body: { targetId: 7 } })));
    expect(await screen.findByRole('heading', { name: /Panne générale/ })).toBeInTheDocument();
  });

  it('affiche le ticket conservé sur un doublon fusionné', async () => {
    mockApi({ ...ticketRoutes(agent), 'GET /tickets/42': makeTicket({ status: 'CLOSED', mergedInto: { id: 7, subject: 'Panne générale' } }) });
    renderApp('/tickets/42');
    expect(await screen.findByRole('link', { name: '#7 Panne générale' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Numéro du ticket à conserver')).not.toBeInTheDocument();
  });
});

describe('administration de la messagerie', () => {
  const box: Mailbox = {
    id: 'mb1',
    name: 'Support',
    address: 'support@mango.fr',
    isActive: true,
    imapHost: 'imap.mango.fr',
    imapPort: null,
    imapSecure: true,
    imapUser: 'support',
    imapFolder: 'INBOX',
    hasPassword: true,
    defaultType: null,
    defaultGroupId: null,
    webhookUrl: 'https://support.mango.fr/api/inbound/email/abc',
    lastCheckedAt: null,
    lastError: 'Authentification refusée',
    lastUid: null,
  };

  it('affiche les boîtes, leur URL de webhook et teste la connexion', async () => {
    mockApi({ 'GET /auth/me': admin, 'GET /admin/mailboxes': [box], 'POST /admin/mailboxes/mb1/test': () => ({ json: { ok: true } }) });
    renderApp('/admin/mail');
    expect(await screen.findByText('https://support.mango.fr/api/inbound/email/abc')).toBeInTheDocument();
    expect(screen.getByText('Dernière erreur : Authentification refusée')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tester' }));
    expect(await screen.findByText('Connexion IMAP réussie.')).toBeInTheDocument();
  });

  it('crée une boîte sans jamais réafficher le mot de passe', async () => {
    const calls = mockApi({ 'GET /auth/me': admin, 'GET /admin/mailboxes': [], 'POST /admin/mailboxes': () => ({ status: 201, json: box }) });
    renderApp('/admin/mail');
    await userEvent.click(await screen.findByRole('button', { name: 'Nouvelle boîte' }));
    await userEvent.type(screen.getByLabelText('Nom'), 'Incidents');
    await userEvent.type(screen.getByLabelText('Adresse'), 'incidents@mango.fr');
    await userEvent.type(screen.getByLabelText('Serveur IMAP'), 'imap.mango.fr');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        name: 'Incidents',
        address: 'incidents@mango.fr',
        imapHost: 'imap.mango.fr',
        imapPassword: 'secret',
        imapUser: null,
      }),
    );
  });

  it('préremplit Gmail et signale une adresse saisie comme serveur', async () => {
    mockApi({ 'GET /auth/me': admin, 'GET /admin/mailboxes': [] });
    renderApp('/admin/mail');
    await userEvent.click(await screen.findByRole('button', { name: 'Nouvelle boîte' }));
    await userEvent.type(screen.getByLabelText('Adresse'), 'moi@gmail.com');
    await userEvent.type(screen.getByLabelText('Serveur IMAP'), 'moi@gmail.com');
    expect(screen.getByText(/L’adresse e-mail va dans « Identifiant »/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Préréglage'), 'gmail');
    expect(screen.getByLabelText('Serveur IMAP')).toHaveValue('imap.gmail.com');
    expect(screen.getByLabelText('Identifiant')).toHaveValue('moi@gmail.com');
    expect(screen.getByText(/mot de passe d’application/)).toBeInTheDocument();
  });

  it('montre le journal et retraite un message conservé', async () => {
    const calls = mockApi({
      'GET /auth/me': admin,
      'GET /admin/mailboxes': [],
      'GET /admin/outbound': [],
      'GET /admin/inbound': {
        items: [
          { id: 'i1', messageId: '<x>', fromAddress: 'vip@client.fr', subject: 'Important', status: 'SPAM', reason: 'Expéditeur bloqué (@client.fr)', ticketId: null, receivedAt: '2026-10-26T08:00:00Z', size: 900, canRetry: true, mailbox: null },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      },
      'POST /admin/inbound/i1/retry': () => ({ json: { status: 'PROCESSED', ticketId: 9 } }),
    });
    renderApp('/admin/mail');
    await userEvent.click(await screen.findByRole('tab', { name: 'Journal' }));
    expect(await screen.findByText('Expéditeur bloqué (@client.fr)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retraiter' }));
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/admin/inbound/i1/retry' })));
  });

  it('enregistre la liste de blocage ligne par ligne', async () => {
    const calls = mockApi({
      'GET /auth/me': admin,
      'GET /admin/mailboxes': [],
      'GET /admin/email-settings': { acknowledge: true, blocklist: [], maxPerSenderPerHour: 20, ignoreBulk: true },
      'PUT /admin/email-settings': (body) => ({ json: body }),
    });
    renderApp('/admin/mail');
    await userEvent.click(await screen.findByRole('tab', { name: 'Réglages' }));
    await userEvent.type(await screen.findByLabelText(/Expéditeurs bloqués/), 'promo@x.fr{enter}@spam.io{enter}');
    await userEvent.click(screen.getByRole('checkbox', { name: /accusé de réception/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ acknowledge: false, blocklist: ['promo@x.fr', '@spam.io'], maxPerSenderPerHour: 20, ignoreBulk: true }),
    );
  });
});
