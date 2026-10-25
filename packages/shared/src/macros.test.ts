import { formatDuration, renderMacro, unknownVariables, type MacroContext } from './macros';

const ctx: MacroContext = {
  ticket: { id: 42, subject: 'Erreur 500' },
  requester: { name: 'Claire Lefèvre' },
  agent: { name: 'Nadia Benali' },
  meeting: {
    url: 'https://meet.google.com/abc-defg-hij',
    startsAt: '2026-10-27T13:00:00Z',
    durationMinutes: 30,
    participants: ['Claire Lefèvre', 'Hugo Martin'],
    bookingUrl: 'https://support.example.com/book/tok',
    slots: ['2026-10-27T13:00:00Z', '2026-10-28T08:30:00Z'],
  },
  timeZone: 'Europe/Paris',
};

describe('renderMacro', () => {
  it('remplace les variables du ticket, des personnes et du rendez-vous', () => {
    const text = renderMacro('Bonjour {{demandeur.prenom}}, ticket #{{ticket.id}} : {{ meet.lien }} ({{meet.duree}})', ctx);
    expect(text).toBe('Bonjour Claire, ticket #42 : https://meet.google.com/abc-defg-hij (30 min)');
  });

  it('formate la date dans le fuseau demandé', () => {
    expect(renderMacro('{{meet.date}}', ctx)).toMatch(/^mardi 27 octobre 2026 à 14:00 \(UTC\+1\)$/);
  });

  it('liste les créneaux proposés', () => {
    expect(renderMacro('{{meet.creneaux}}', ctx).split('\n')).toHaveLength(2);
  });

  it('laisse vides les variables de rendez-vous sans rendez-vous', () => {
    expect(renderMacro('[{{meet.lien}}]', { ...ctx, meeting: undefined })).toBe('[]');
  });

  it('conserve et signale les variables inconnues', () => {
    expect(renderMacro('{{demandeur.age}}', ctx)).toBe('{{demandeur.age}}');
    expect(unknownVariables('{{ticket.id}} {{demandeur.age}} {{meet.lein}}')).toEqual(['demandeur.age', 'meet.lein']);
  });
});

describe('formatDuration', () => {
  it.each([
    [15, '15 min'],
    [60, '1 h'],
    [90, '1 h 30'],
  ])('%i → %s', (m, expected) => expect(formatDuration(m)).toBe(expected));
});
