import { compileNotes, defaultReleaseCategory } from './releases';

describe('release notes', () => {
  it('classe par défaut selon le type', () => {
    expect(defaultReleaseCategory('FEATURE_REQUEST')).toBe('NEW');
    expect(defaultReleaseCategory('BUG')).toBe('FIX');
    expect(defaultReleaseCategory('QUESTION')).toBe('ARCHITECTURE');
  });

  it('compile deux niveaux : technique complet, clients limité aux résumés', () => {
    const notes = compileNotes([
      { ticketId: 9, category: 'FIX', subject: 'NPE sur /auth', summary: 'La connexion ne plante plus.', component: 'AUTH' },
      { ticketId: 3, category: 'FIX', subject: 'Index manquant', summary: '  ', component: 'DATABASE' },
      { ticketId: 5, category: 'NEW', subject: 'Export CSV', summary: null, component: null },
    ]);
    expect(notes.technical.map((s) => [s.category, s.items.map((i) => i.ticketId)])).toEqual([
      ['NEW', [5]],
      ['FIX', [3, 9]],
    ]);
    expect(notes.customer).toEqual([{ category: 'FIX', items: [{ text: 'La connexion ne plante plus.' }] }]);
  });
});
