import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Macro, Meeting, User } from './api/types';
import { applyReplacement } from './components/Spellcheck';
import { agent, makeTicket, mockApi, renderApp } from './test/utils';

const developer: User = { id: 'u-dev', email: 'dev@test.local', name: 'Hugo Dev', role: 'DEVELOPER' };
const admin: User = { id: 'u-admin', email: 'admin@test.local', name: 'Ada Admin', role: 'ADMIN' };

const macro = (over: Partial<Macro>): Macro => ({
  id: 'm1',
  systemKey: null,
  name: 'Accusé de réception',
  body: 'Bonjour {{demandeur.prenom}}, nous traitons la demande #{{ticket.id}}.',
  isInternal: false,
  actions: {},
  position: 0,
  isActive: true,
  ...over,
});

const meeting: Meeting = {
  id: 'mt1',
  ticketId: 42,
  title: 'Ticket #42',
  durationMinutes: 30,
  status: 'SCHEDULED',
  startsAt: '2026-11-03T13:00:00.000Z',
  meetUrl: 'https://meet.demo.invalid/abc-defg-hij',
  provider: 'demo',
  bookingUrl: null,
  slots: [{ id: 's1', startsAt: '2026-11-03T13:00:00.000Z' }],
  organizer: { id: agent.id, name: agent.name },
  participants: [
    { id: 'u-ext', name: 'Charles Client' },
    { id: developer.id, name: developer.name },
    { id: agent.id, name: agent.name },
  ],
  createdAt: '2026-10-25T10:00:00.000Z',
};

const ticketRoutes = (user: User) => ({
  'GET /auth/me': user,
  'GET /tickets/42': makeTicket(),
  'GET /tickets/42/comments': [],
  'GET /tickets/42/audit': [],
  'GET /agents': [],
});

describe('macros dans la réponse', () => {
  it('insère le texte avec ses variables puis l’applique à l’envoi', async () => {
    const calls = mockApi({
      ...ticketRoutes(agent),
      'GET /macros': [macro({ actions: { status: 'QUALIFYING' } })],
      'POST /macros/m1/apply': () => ({ json: { comment: {}, ticket: makeTicket() } }),
    });
    renderApp('/tickets/42');

    await userEvent.selectOptions(await screen.findByLabelText('Appliquer une macro'), 'm1');
    const textarea = screen.getByLabelText('Votre message');
    expect(textarea).toHaveValue('Bonjour Charles, nous traitons la demande #42.');
    expect(screen.getByText(/Actions à l’envoi : statut → En cours de qualification/)).toBeInTheDocument();

    await userEvent.type(textarea, ' Merci.');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer et appliquer' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          path: '/macros/m1/apply',
          body: { ticketId: 42, body: 'Bonjour Charles, nous traitons la demande #42. Merci.' },
        }),
      ),
    );
  });
});

describe('correcteur', () => {
  it('signale une faute et applique la suggestion choisie', async () => {
    mockApi({
      ...ticketRoutes(agent),
      'POST /spellcheck': () => ({
        json: { issues: [{ offset: 5, length: 4, message: 'Faute de frappe possible.', category: 'TYPOS', ruleId: 'R', replacements: ['avons', 'savons'] }] },
      }),
    });
    renderApp('/tickets/42');
    const textarea = await screen.findByLabelText('Votre message');
    expect(textarea).toHaveAttribute('lang', 'fr');
    await userEvent.type(textarea, 'Nous avon corrigé.');
    await userEvent.click(screen.getByRole('button', { name: /Vérifier l’orthographe/ }));

    expect(await screen.findByText('Faute de frappe possible.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'avons' }));
    expect(textarea).toHaveValue('Nous avons corrigé.');
    expect(await screen.findByText('Aucune faute détectée.')).toBeInTheDocument();
  });

  it('recale les corrections restantes après un remplacement', () => {
    const issues = [
      { offset: 0, length: 3, message: '', category: 'TYPOS', ruleId: 'A', replacements: ['Les'] },
      { offset: 10, length: 2, message: '', category: 'TYPOS', ruleId: 'B', replacements: ['sont'] },
    ];
    const next = applyReplacement('Lse chats so là', issues, issues[0]!, 'Les');
    expect(next.text).toBe('Les chats so là');
    expect(next.issues).toEqual([issues[1]]);
    const shifted = applyReplacement('ab cd', [{ ...issues[0]!, offset: 0, length: 2 }, { ...issues[1]!, offset: 3 }], { ...issues[0]!, offset: 0, length: 2 }, 'abcd');
    expect(shifted.issues[0]!.offset).toBe(5);
  });
});

describe('rendez-vous', () => {
  it('crée un Meet et prépare l’invitation dans la réponse', async () => {
    const invitation = macro({
      id: 'sys',
      systemKey: 'meeting_scheduled',
      name: 'Invitation Meet',
      body: 'Bonjour {{demandeur.prenom}}, rendez-vous ici : {{meet.lien}} ({{meet.duree}}) avec {{meet.participants}}',
    });
    const calls = mockApi({
      ...ticketRoutes(agent),
      'GET /macros': [invitation],
      'GET /developers': [{ id: developer.id, name: developer.name }],
      'POST /tickets/42/meetings': () => ({ status: 201, json: meeting }),
    });
    renderApp('/tickets/42');

    await userEvent.click(await screen.findByRole('button', { name: 'Planifier un Meet' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Hugo Dev' }));
    await userEvent.click(screen.getByRole('button', { name: 'Créer le Meet' }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.path === '/tickets/42/meetings');
      expect(post?.body).toMatchObject({ mode: 'direct', durationMinutes: 30, developerIds: [developer.id] });
      expect((post?.body as { slots: string[] }).slots).toHaveLength(1);
    });
    expect(await screen.findByLabelText('Votre message')).toHaveValue(
      'Bonjour Charles, rendez-vous ici : https://meet.demo.invalid/abc-defg-hij (30 min) avec Charles Client, Hugo Dev, Alice Agent',
    );
  });

  it('propose plusieurs créneaux en mode proposition', async () => {
    const calls = mockApi({
      ...ticketRoutes(agent),
      'GET /developers': [],
      'POST /tickets/42/meetings': () => ({ status: 201, json: { ...meeting, status: 'PROPOSED', meetUrl: null } }),
    });
    renderApp('/tickets/42');
    await userEvent.click(await screen.findByRole('button', { name: 'Planifier un Meet' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Proposer des créneaux' }));
    expect(screen.getAllByLabelText(/Créneau \d/)).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Proposer les créneaux' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/tickets/42/meetings' && c.method === 'POST')?.body).toMatchObject({ mode: 'proposal' }),
    );
  });

  it('signale un lien de démo et réserve la planification au support', async () => {
    mockApi({ ...ticketRoutes(developer), 'GET /tickets/42/meetings': [meeting] });
    renderApp('/tickets/42');
    const item = (await screen.findByRole('link', { name: meeting.meetUrl! })).closest('li')!;
    expect(within(item).getByText('démo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Planifier un Meet' })).not.toBeInTheDocument();
    // Le développeur n'écrit que des notes internes.
    expect(screen.queryByRole('tab', { name: 'Réponse publique' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter la note' })).toBeInTheDocument();
  });
});

describe('page publique de réservation', () => {
  it('laisse choisir un créneau sans connexion puis affiche la confirmation', async () => {
    const booking = {
      status: 'PROPOSED',
      title: 'Ticket #42',
      ticket: { id: 42, subject: 'Export KO' },
      organizer: 'Alice Agent',
      durationMinutes: 45,
      participants: ['Charles Client', 'Alice Agent'],
      slots: [
        { id: 's1', startsAt: '2026-11-03T09:00:00.000Z' },
        { id: 's2', startsAt: '2026-11-04T13:00:00.000Z' },
      ],
      startsAt: null,
      meetUrl: null,
      provider: 'demo',
    };
    const calls = mockApi({
      'GET /auth/me': () => ({ status: 401, json: {} }),
      'GET /public/bookings/tok123': booking,
      'POST /public/bookings/tok123': () => ({
        json: { ...booking, status: 'SCHEDULED', startsAt: booking.slots[1]!.startsAt, meetUrl: 'https://meet.demo.invalid/x', slots: [] },
      }),
    });
    renderApp('/book/tok123');

    expect(await screen.findByText(/Demande #42 « Export KO » · visio de 45 min/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirmer ce créneau' });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getAllByRole('radio')[1]!);
    await userEvent.click(confirm);

    expect(await screen.findByText('Rendez-vous confirmé')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rejoindre la visio' })).toHaveAttribute('href', 'https://meet.demo.invalid/x');
    expect(calls).toContainEqual(expect.objectContaining({ method: 'POST', body: { slotId: 's2' } }));
  });
});

describe('administration des macros', () => {
  it('insère une variable, prévisualise et bloque une variable inconnue', async () => {
    mockApi({ 'GET /auth/me': admin, 'GET /admin/macros': [] });
    renderApp('/admin/macros');
    await userEvent.click(await screen.findByRole('button', { name: 'Nouvelle macro' }));
    const text = screen.getByLabelText('Texte');
    await userEvent.type(text, 'Bonjour ');
    await userEvent.click(screen.getByRole('button', { name: 'Prénom du demandeur' }));
    expect(text).toHaveValue('Bonjour {{demandeur.prenom}}');
    expect(screen.getByText('Bonjour Claire')).toBeInTheDocument();

    // Collage plutôt que frappe : user-event interprète les accolades comme des touches spéciales.
    await userEvent.click(text);
    (text as HTMLTextAreaElement).setSelectionRange(1000, 1000);
    await userEvent.paste(' {{demandeur.age}}');
    expect(screen.getByText(/Variable\(s\) inconnue\(s\) : \{\{demandeur\.age\}\}/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  });
});
