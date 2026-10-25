/**
 * Calcul en heures ouvrées dans un fuseau horaire donné, sans dépendance :
 * les conversions heure locale ↔ instant passent par Intl (changements d'heure compris).
 */

/** Plage d'ouverture d'une journée, en heure locale « HH:MM ». */
export interface DayHours {
  start: string;
  end: string;
}

export interface BusinessHours {
  timeZone: string;
  /** Index 0 = lundi … 6 = dimanche ; null = fermé. */
  week: (DayHours | null)[];
  /** Exclure les jours fériés français. */
  frenchHolidays: boolean;
  /** Jours fermés supplémentaires (AAAA-MM-JJ, heure locale). */
  closedDates: string[];
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  timeZone: 'Europe/Paris',
  week: [...Array(5).fill({ start: '08:00', end: '18:00' }), null, null],
  frenchHolidays: true,
  closedDates: [],
};

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Garde-fou : on ne parcourt jamais plus de dix ans de calendrier. */
const MAX_DAYS = 3660;

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function zonedParts(time: number, timeZone: string) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(time).map((p) => [p.type, Number(p.value)]));
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** Décalage du fuseau à cet instant, en millisecondes (heure locale − UTC). */
function offset(time: number, timeZone: string): number {
  const p = zonedParts(time, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(time / 1000) * 1000;
}

/** Instant correspondant à une heure locale (une heure inexistante, au passage à l'heure d'été, est décalée). */
export function zonedTimeToUtc(d: LocalDate, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(d.year, d.month - 1, d.day, hour, minute);
  const first = guess - offset(guess, timeZone);
  const second = guess - offset(first, timeZone);
  return first === second ? first : Math.max(first, second);
}

function localDate(time: number, timeZone: string): LocalDate {
  const { year, month, day } = zonedParts(time, timeZone);
  return { year, month, day };
}

function nextDate(d: LocalDate): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + 1));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

const iso = (d: LocalDate) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/** Lundi de Pâques et fêtes mobiles : algorithme de Meeus/Jones/Butcher. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const holidayCache = new Map<number, Set<string>>();
/** Jours fériés de France métropolitaine (AAAA-MM-JJ). */
export function frenchHolidays(year: number): Set<string> {
  let set = holidayCache.get(year);
  if (!set) {
    const easter = easterSunday(year).getTime();
    const shifted = (days: number) => new Date(easter + days * DAY).toISOString().slice(0, 10);
    set = new Set([
      ...['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'].map((md) => `${year}-${md}`),
      shifted(1), // lundi de Pâques
      shifted(39), // Ascension
      shifted(50), // lundi de Pentecôte
    ]);
    holidayCache.set(year, set);
  }
  return set;
}

function parseHm(hm: string): [number, number] {
  const [h, m] = hm.split(':').map(Number);
  return [h ?? 0, m ?? 0];
}

/** Plage ouverte d'une journée locale, en instants UTC ; null si fermé. */
function openInterval(d: LocalDate, bh: BusinessHours): [number, number] | null {
  const key = iso(d);
  if (bh.closedDates.includes(key) || (bh.frenchHolidays && frenchHolidays(d.year).has(key))) return null;
  const weekday = (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7;
  const hours = bh.week[weekday];
  if (!hours) return null;
  const start = zonedTimeToUtc(d, ...parseHm(hours.start), bh.timeZone);
  const end = zonedTimeToUtc(d, ...parseHm(hours.end), bh.timeZone);
  return end > start ? [start, end] : null;
}

export function hasOpenDays(bh: BusinessHours): boolean {
  return bh.week.some((h) => h && h.end > h.start);
}

/** Minutes ouvrées entre deux instants (0 si b ≤ a). */
export function businessMinutesBetween(a: Date | number, b: Date | number, bh: BusinessHours): number {
  const from = +a;
  const to = +b;
  if (to <= from) return 0;
  let total = 0;
  let d = localDate(from, bh.timeZone);
  for (let i = 0; i < MAX_DAYS; i++) {
    const interval = openInterval(d, bh);
    if (interval) {
      if (interval[0] >= to) break;
      total += Math.max(0, Math.min(interval[1], to) - Math.max(interval[0], from));
    } else if (zonedTimeToUtc(d, 0, 0, bh.timeZone) >= to) {
      break;
    }
    d = nextDate(d);
  }
  return Math.floor(total / MINUTE);
}

/** Instant atteint après `minutes` minutes ouvrées à partir de `start`. */
export function addBusinessMinutes(start: Date | number, minutes: number, bh: BusinessHours): Date {
  if (!hasOpenDays(bh)) throw new Error('Aucun jour ouvré configuré');
  let remaining = minutes * MINUTE;
  const from = +start;
  let d = localDate(from, bh.timeZone);
  for (let i = 0; i < MAX_DAYS; i++) {
    const interval = openInterval(d, bh);
    if (interval && interval[1] > from) {
      const begin = Math.max(interval[0], from);
      const available = interval[1] - begin;
      if (remaining <= available) return new Date(begin + remaining);
      remaining -= available;
    }
    d = nextDate(d);
  }
  throw new Error('Échéance hors de la période calculable');
}
