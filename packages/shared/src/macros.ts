/**
 * Macros : réponses types avec variables, et actions appliquées au ticket.
 * Le rendu est partagé entre l'interface (aperçu) et l'API (messages automatiques).
 */
import type { TicketStatus } from './workflow';

export interface MacroActions {
  status?: TicketStatus;
  addTagIds?: string[];
  assignToMe?: boolean;
}

/** Macros créées par l'application et préremplies après une prise de rendez-vous. */
export const SYSTEM_MACRO_KEYS = {
  meetingScheduled: 'meeting_scheduled',
  meetingProposal: 'meeting_proposal',
} as const;

export const MACRO_VARIABLES = [
  { key: 'ticket.id', label: 'Numéro du ticket' },
  { key: 'ticket.sujet', label: 'Sujet du ticket' },
  { key: 'demandeur.nom', label: 'Nom du demandeur' },
  { key: 'demandeur.prenom', label: 'Prénom du demandeur' },
  { key: 'agent.nom', label: "Nom de l'agent" },
  { key: 'agent.prenom', label: "Prénom de l'agent" },
  { key: 'meet.lien', label: 'Lien Google Meet' },
  { key: 'meet.date', label: 'Date et heure du rendez-vous' },
  { key: 'meet.duree', label: 'Durée du rendez-vous' },
  { key: 'meet.participants', label: 'Participants' },
  { key: 'meet.reservation', label: 'Lien de réservation des créneaux' },
  { key: 'meet.creneaux', label: 'Créneaux proposés' },
] as const;
export type MacroVariable = (typeof MACRO_VARIABLES)[number]['key'];

export interface MacroContext {
  ticket: { id: number; subject: string };
  requester: { name: string };
  agent: { name: string };
  meeting?: {
    url?: string | null;
    startsAt?: string | Date | null;
    durationMinutes: number;
    participants: string[];
    bookingUrl?: string | null;
    slots?: (string | Date)[];
  };
  /** Fuseau horaire d'affichage des dates (ex. Europe/Paris). */
  timeZone: string;
}

export function formatMeetingDate(date: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(date)) + ` (${timeZoneLabel(date, timeZone)})`;
}

function timeZoneLabel(date: string | Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat('fr-FR', { timeZone, timeZoneName: 'short' })
    .formatToParts(new Date(date))
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function variables(ctx: MacroContext): Record<MacroVariable, string> {
  const m = ctx.meeting;
  return {
    'ticket.id': String(ctx.ticket.id),
    'ticket.sujet': ctx.ticket.subject,
    'demandeur.nom': ctx.requester.name,
    'demandeur.prenom': firstName(ctx.requester.name),
    'agent.nom': ctx.agent.name,
    'agent.prenom': firstName(ctx.agent.name),
    'meet.lien': m?.url ?? '',
    'meet.date': m?.startsAt ? formatMeetingDate(m.startsAt, ctx.timeZone) : '',
    'meet.duree': m ? formatDuration(m.durationMinutes) : '',
    'meet.participants': m ? m.participants.join(', ') : '',
    'meet.reservation': m?.bookingUrl ?? '',
    'meet.creneaux': (m?.slots ?? []).map((s) => `- ${formatMeetingDate(s, ctx.timeZone)}`).join('\n'),
  };
}

/** Remplace les {{variables}} connues ; une variable inconnue est laissée telle quelle pour être repérée. */
export function renderMacro(template: string, ctx: MacroContext): string {
  const values = variables(ctx);
  return template.replace(/\{\{\s*([a-z.]+)\s*\}\}/g, (match, key: string) =>
    key in values ? values[key as MacroVariable] : match,
  );
}

/** Variables utilisées par un modèle qui n'existent pas (faute de frappe…). */
export function unknownVariables(template: string): string[] {
  const known = new Set<string>(MACRO_VARIABLES.map((v) => v.key));
  return [...template.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]!).filter((k) => !known.has(k));
}
