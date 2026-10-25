/**
 * Mise en page administrable : champs du ticket, colonnes de la liste et vues.
 */
import type { Priority } from './priority';
import type { SlaState } from './sla';
import type { TicketStatus } from './workflow';

export const TICKET_FORM_FIELDS = ['type', 'component', 'environment', 'impact', 'urgency', 'tags'] as const;
export type TicketFormField = (typeof TICKET_FORM_FIELDS)[number];

export const TICKET_FORM_FIELD_LABELS: Record<TicketFormField, string> = {
  type: 'Type',
  component: 'Module',
  environment: 'Environnement',
  impact: 'Impact',
  urgency: 'Urgence',
  tags: 'Tags',
};

export const LIST_COLUMNS = [
  'id',
  'subject',
  'priority',
  'status',
  'sla',
  'type',
  'component',
  'environment',
  'tags',
  'requester',
  'group',
  'assignee',
  'createdAt',
  'updatedAt',
] as const;
export type ListColumn = (typeof LIST_COLUMNS)[number];

export const LIST_COLUMN_LABELS: Record<ListColumn, string> = {
  id: '#',
  subject: 'Sujet',
  priority: 'Priorité',
  status: 'Statut',
  sla: 'SLA',
  type: 'Type',
  component: 'Module',
  environment: 'Environnement',
  tags: 'Tags',
  requester: 'Demandeur',
  group: 'Groupe',
  assignee: 'Assigné',
  createdAt: 'Créé le',
  updatedAt: 'Mis à jour le',
};

/** Élément d'une mise en page ordonnée : sa position est celle du tableau. */
export interface LayoutItem<T extends string> {
  key: T;
  visible: boolean;
}

export const DEFAULT_TICKET_FORM: LayoutItem<TicketFormField>[] = TICKET_FORM_FIELDS.map((key) => ({
  key,
  visible: true,
}));

const HIDDEN_BY_DEFAULT: ListColumn[] = ['environment', 'requester', 'updatedAt'];
export const DEFAULT_LIST_COLUMNS: LayoutItem<ListColumn>[] = LIST_COLUMNS.map((key) => ({
  key,
  visible: !HIDDEN_BY_DEFAULT.includes(key),
}));

/**
 * Complète une mise en page enregistrée : les éléments inconnus sont ignorés et
 * ceux ajoutés depuis par l'application sont placés à la fin, visibles.
 */
export function normalizeLayout<T extends string>(saved: unknown, all: readonly T[]): LayoutItem<T>[] {
  const items = Array.isArray(saved) ? (saved as LayoutItem<T>[]) : [];
  const known = items.filter((i) => all.includes(i?.key) && typeof i.visible === 'boolean');
  const seen = new Set(known.map((i) => i.key));
  const unique = known.filter((i, idx) => known.findIndex((j) => j.key === i.key) === idx);
  return [...unique, ...all.filter((k) => !seen.has(k)).map((key) => ({ key, visible: true }))];
}

/** Filtres d'une vue enregistrée. `assignee` accepte « me » (l'agent connecté) et « none ». */
export interface ViewFilters {
  status?: 'open' | TicketStatus[];
  priority?: Priority[];
  type?: string;
  component?: string;
  assignee?: 'me' | 'none' | string;
  /** « mine » : les groupes de l'agent connecté. */
  group?: 'mine' | string;
  slaState?: SlaState[];
  tagId?: string;
  /** Le demandeur attend une réponse du support. */
  awaitingAgent?: boolean;
}
