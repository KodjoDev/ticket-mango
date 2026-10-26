import { IMPACT_LABELS, STATUS_LABELS, URGENCY_LABELS, type OptionField } from '@ticketing/shared';

/** Libellés lisibles des actions du journal d'audit. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'ticket.created': 'a créé le ticket',
  'ticket.updated': 'a modifié le ticket',
  'ticket.status_changed': 'a changé le statut',
  'comment.created': 'a ajouté un commentaire',
  'ticket.dev_linked': 'a lié une issue de développement',
  'ticket.dev_unlinked': 'a détaché une issue de développement',
  'ticket.dev_synced': 'synchronisation avec l’outil de développement',
};

const LIST_FIELDS: Record<string, OptionField> = { type: 'TYPE', component: 'COMPONENT', environment: 'ENVIRONMENT' };

export const FIELD_LABELS: Record<string, string> = {
  subject: 'Sujet',
  description: 'Description',
  type: 'Type',
  component: 'Module',
  environment: 'Environnement',
  impact: 'Impact',
  urgency: 'Urgence',
  priority: 'Priorité',
  priorityOverridden: 'Priorité forcée',
  requester: 'Demandeur',
  fixedInVersion: 'Corrigé dans la version',
  assigneeId: 'Assigné',
  status: 'Statut',
  tags: 'Tags',
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  impact: IMPACT_LABELS,
  urgency: URGENCY_LABELS,
  status: STATUS_LABELS,
};

interface AuditContext {
  /** Noms des utilisateurs, pour les identifiants d'assignation. */
  names: Map<string, string>;
  /** Libellé courant d'une clé de liste administrable. */
  label: (field: OptionField, key: string) => string;
}

/** Rend lisible une valeur du journal d'audit. */
export function formatAuditValue(field: string, value: unknown, ctx: AuditContext): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'aucun';
  if (field === 'assigneeId') return ctx.names.get(String(value)) ?? 'un agent';
  if (LIST_FIELDS[field]) return ctx.label(LIST_FIELDS[field], String(value));
  return VALUE_LABELS[field]?.[String(value)] ?? String(value);
}
