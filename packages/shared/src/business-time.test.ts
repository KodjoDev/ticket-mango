import {
  addBusinessMinutes,
  businessMinutesBetween,
  DEFAULT_BUSINESS_HOURS as BH,
  frenchHolidays,
  zonedTimeToUtc,
} from './business-time';

const at = (iso: string) => new Date(iso);

describe('zonedTimeToUtc', () => {
  it('convertit une heure de Paris en hiver (UTC+1) et en été (UTC+2)', () => {
    expect(new Date(zonedTimeToUtc({ year: 2026, month: 1, day: 15 }, 8, 0, 'Europe/Paris')).toISOString()).toBe(
      '2026-01-15T07:00:00.000Z',
    );
    expect(new Date(zonedTimeToUtc({ year: 2026, month: 7, day: 15 }, 8, 0, 'Europe/Paris')).toISOString()).toBe(
      '2026-07-15T06:00:00.000Z',
    );
  });
});

describe('frenchHolidays', () => {
  it('calcule les fêtes fixes et mobiles', () => {
    const h = frenchHolidays(2026);
    // Pâques 2026 : 5 avril.
    expect([...h].sort()).toEqual([
      '2026-01-01',
      '2026-04-06',
      '2026-05-01',
      '2026-05-08',
      '2026-05-14',
      '2026-05-25',
      '2026-07-14',
      '2026-08-15',
      '2026-11-01',
      '2026-11-11',
      '2026-12-25',
    ]);
  });
});

describe('businessMinutesBetween (lundi-vendredi 8h-18h, Paris)', () => {
  it('compte les minutes dans une même journée', () => {
    // Mardi 3 mars 2026, 9h → 11h30 (heure de Paris = UTC+1)
    expect(businessMinutesBetween(at('2026-03-03T08:00:00Z'), at('2026-03-03T10:30:00Z'), BH)).toBe(150);
  });

  it('ignore la nuit et le week-end', () => {
    // Vendredi 17h → lundi 9h : 1 h vendredi + 1 h lundi
    expect(businessMinutesBetween(at('2026-03-06T16:00:00Z'), at('2026-03-09T08:00:00Z'), BH)).toBe(120);
  });

  it('ignore les jours fériés et les fermetures exceptionnelles', () => {
    // Mardi 10 novembre 17h → jeudi 12 novembre 9h, le 11 étant férié : 2 h
    expect(businessMinutesBetween(at('2026-11-10T16:00:00Z'), at('2026-11-12T08:00:00Z'), BH)).toBe(120);
    const closed = { ...BH, closedDates: ['2026-11-12'] };
    expect(businessMinutesBetween(at('2026-11-10T16:00:00Z'), at('2026-11-12T08:00:00Z'), closed)).toBe(60);
  });

  it('reste juste au passage à l’heure d’été', () => {
    // Vendredi 27 mars 17h (UTC+1) → lundi 30 mars 9h (UTC+2) : 2 h
    expect(businessMinutesBetween(at('2026-03-27T16:00:00Z'), at('2026-03-30T07:00:00Z'), BH)).toBe(120);
  });

  it('vaut 0 hors horaires ou à l’envers', () => {
    expect(businessMinutesBetween(at('2026-03-07T10:00:00Z'), at('2026-03-08T10:00:00Z'), BH)).toBe(0);
    expect(businessMinutesBetween(at('2026-03-03T10:00:00Z'), at('2026-03-03T09:00:00Z'), BH)).toBe(0);
  });
});

describe('addBusinessMinutes', () => {
  it('reporte au jour ouvré suivant', () => {
    // Vendredi 17h + 4 h → lundi 11h (Paris)
    expect(addBusinessMinutes(at('2026-03-06T16:00:00Z'), 240, BH).toISOString()).toBe('2026-03-09T10:00:00.000Z');
  });

  it('démarre à l’ouverture si l’on part hors horaires', () => {
    // Samedi + 1 h → lundi 9h
    expect(addBusinessMinutes(at('2026-03-07T12:00:00Z'), 60, BH).toISOString()).toBe('2026-03-09T08:00:00.000Z');
  });

  it('est l’inverse de businessMinutesBetween', () => {
    const start = at('2026-12-23T15:12:00Z');
    const due = addBusinessMinutes(start, 48 * 60, BH);
    expect(businessMinutesBetween(start, due, BH)).toBe(48 * 60);
  });

  it('refuse un calendrier sans aucun jour ouvré', () => {
    expect(() => addBusinessMinutes(new Date(), 60, { ...BH, week: Array(7).fill(null) })).toThrow();
  });
});
