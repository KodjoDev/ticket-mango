import { computeSla, DEFAULT_SLA_POLICY, type SlaInput } from './sla';

const at = (iso: string) => new Date(iso);
// Mardi 3 mars 2026, 9h à Paris.
const created = at('2026-03-03T08:00:00Z');
const base: SlaInput = { priority: 'P2', createdAt: created, firstResponseAt: null, resolvedAt: null, pauses: [], now: created };
const minutesLater = (m: number) => new Date(+created + m * 60_000);

describe('computeSla', () => {
  it('démarre dans les délais avec les échéances de la priorité', () => {
    const sla = computeSla(base);
    expect(sla.calendar).toBe('BUSINESS');
    expect(sla.firstResponse).toMatchObject({ state: 'OK', remainingMinutes: 60 });
    expect(sla.firstResponse.dueAt?.toISOString()).toBe('2026-03-03T09:00:00.000Z');
    // P2 : 9h + 8 h ouvrées (journée 8h-18h) → 17h le même jour
    expect(sla.resolution.dueAt?.toISOString()).toBe('2026-03-03T16:00:00.000Z');
    expect(sla.state).toBe('OK');
    expect(sla.dueAt).toEqual(sla.firstResponse.dueAt);
  });

  it('passe à risque à 80 % puis dépassé', () => {
    expect(computeSla({ ...base, now: minutesLater(48) }).state).toBe('WARNING');
    const late = computeSla({ ...base, now: minutesLater(75) });
    expect(late.state).toBe('BREACHED');
    expect(late.firstResponse).toMatchObject({ state: 'BREACHED', remainingMinutes: -15, dueAt: null });
  });

  it('distingue délai tenu et manqué une fois atteint', () => {
    const met = computeSla({ ...base, firstResponseAt: minutesLater(30), now: minutesLater(120) });
    expect(met.firstResponse.state).toBe('MET');
    const missed = computeSla({ ...base, firstResponseAt: minutesLater(90), now: minutesLater(120) });
    expect(missed.firstResponse.state).toBe('MISSED');
    // La résolution court toujours : l'état global la reflète.
    expect(missed.state).toBe('OK');
  });

  it('suspend la résolution pendant l’attente du client', () => {
    const sla = computeSla({
      ...base,
      firstResponseAt: minutesLater(10),
      pauses: [{ startedAt: minutesLater(60), endedAt: null }],
      now: minutesLater(600),
    });
    expect(sla.resolution).toMatchObject({ state: 'PAUSED', elapsedMinutes: 60, dueAt: null });
    expect(sla.state).toBe('PAUSED');
  });

  it('déduit les pauses terminées', () => {
    const sla = computeSla({
      ...base,
      firstResponseAt: minutesLater(10),
      pauses: [{ startedAt: minutesLater(60), endedAt: minutesLater(180) }],
      now: minutesLater(240),
    });
    expect(sla.resolution.elapsedMinutes).toBe(120);
  });

  it('décompte P0/P1 en continu, nuit comprise', () => {
    const night = at('2026-03-07T22:00:00Z'); // samedi soir
    const sla = computeSla({ ...base, priority: 'P1', createdAt: night, now: new Date(+night + 30 * 60_000) });
    expect(sla.calendar).toBe('ALWAYS');
    expect(sla.firstResponse.state).toBe('BREACHED');
    expect(sla.resolution).toMatchObject({ state: 'OK', remainingMinutes: 90 });
  });

  it('est terminé quand tout est atteint', () => {
    expect(computeSla({ ...base, firstResponseAt: minutesLater(5), resolvedAt: minutesLater(60), now: minutesLater(999) }).state).toBe('DONE');
  });

  it('respecte un seuil d’alerte personnalisé', () => {
    const policy = { ...DEFAULT_SLA_POLICY, warningPercent: 50 };
    expect(computeSla({ ...base, now: minutesLater(31) }, policy).state).toBe('WARNING');
  });
});
