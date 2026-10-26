import { blocksOf, DEFAULT_TICKET_PAGE, normalizeTicketPage, PAGE_BLOCKS } from './ticket-page';

describe('disposition de la page ticket', () => {
  it('la disposition par défaut contient chaque bloc une fois', () => {
    expect(DEFAULT_TICKET_PAGE.map((i) => i.key).sort()).toEqual([...PAGE_BLOCKS].sort());
    expect(blocksOf(DEFAULT_TICKET_PAGE, 'main')).toEqual(['description', 'meetings', 'conversation', 'requesterHistory', 'history']);
    expect(blocksOf(DEFAULT_TICKET_PAGE, 'side')[0]).toBe('requester');
  });

  it('ignore inconnus et doublons, complète les blocs manquants', () => {
    const layout = normalizeTicketPage([
      { key: 'sla', visible: true, column: 'main' },
      { key: 'sla', visible: false, column: 'side' },
      { key: 'inconnu', visible: true, column: 'main' },
      { key: 'dates', visible: 'oui', column: 'side' },
    ]);
    expect(layout[0]).toEqual({ key: 'sla', visible: true, column: 'main' });
    expect(layout.filter((i) => i.key === 'sla')).toHaveLength(1);
    expect(layout).toHaveLength(PAGE_BLOCKS.length);
    expect(layout.find((i) => i.key === 'dates')).toEqual({ key: 'dates', visible: true, column: 'side' });
  });

  it('garde la description et la conversation visibles', () => {
    const layout = normalizeTicketPage([{ key: 'conversation', visible: false, column: 'side' }]);
    expect(layout.find((i) => i.key === 'conversation')).toEqual({ key: 'conversation', visible: true, column: 'side' });
  });

  it('retombe sur la disposition par défaut sans réglage valide', () => {
    expect(normalizeTicketPage(null)).toEqual(DEFAULT_TICKET_PAGE);
  });
});
