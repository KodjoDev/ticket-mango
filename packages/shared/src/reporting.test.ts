import { buildReport, type ReportTicket } from './reporting';

const d = (iso: string) => new Date(`2026-10-01T${iso}:00Z`);
const t = (over: Partial<ReportTicket>): ReportTicket => ({
  channel: 'WEB',
  type: 'BUG',
  priority: 'P2',
  component: 'API',
  slaState: 'OK',
  createdAt: d('08:00'),
  firstResponseAt: null,
  resolvedAt: null,
  ...over,
});

describe('buildReport', () => {
  it('renvoie un rapport vide sans ticket', () => {
    expect(buildReport([])).toMatchObject({ total: 0, avgFirstResponseMinutes: null, avgResolutionMinutes: null, slaCompliance: null, topBugComponents: [] });
  });

  it('compte par canal, type et priorité', () => {
    const r = buildReport([t({}), t({ channel: 'EMAIL', type: 'QUESTION', priority: 'P4' }), t({})]);
    expect(r.byChannel).toEqual([{ key: 'WEB', count: 2 }, { key: 'EMAIL', count: 1 }]);
    expect(r.byType[0]).toEqual({ key: 'BUG', count: 2 });
    expect(r.byPriority.map((c) => c.key)).toEqual(['P2', 'P4']);
  });

  it('moyenne les délais et ignore les tickets sans réponse ou résolution', () => {
    const r = buildReport([
      t({ firstResponseAt: d('08:10'), resolvedAt: d('10:00') }),
      t({ firstResponseAt: d('08:30'), resolvedAt: d('12:00') }),
      t({}),
    ]);
    expect(r.avgFirstResponseMinutes).toBe(20);
    expect(r.avgResolutionMinutes).toBe(180);
  });

  it('calcule le respect du SLA hors pauses', () => {
    const r = buildReport([t({}), t({ slaState: 'BREACHED' }), t({ slaState: 'PAUSED' }), t({ slaState: 'DONE' })]);
    expect(r.slaCompliance).toBeCloseTo(2 / 3);
  });

  it('classe les 5 modules les plus générateurs de bugs', () => {
    const tickets = [
      ...Array.from({ length: 3 }, () => t({ component: 'AUTH' })),
      t({ component: 'API', type: 'MAJOR_INCIDENT' }),
      t({ component: 'API' }),
      t({ component: 'BILLING', type: 'QUESTION' }),
      ...['A', 'B', 'C', 'D'].map((component) => t({ component })),
    ];
    const top = buildReport(tickets).topBugComponents;
    expect(top).toHaveLength(5);
    expect(top.slice(0, 2)).toEqual([{ key: 'AUTH', count: 3 }, { key: 'API', count: 2 }]);
    expect(top.map((c) => c.key)).not.toContain('BILLING');
  });
});
