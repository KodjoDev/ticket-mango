import {
  COMPONENT_LABELS,
  ENVIRONMENT_LABELS,
  IMPACT_LABELS,
  STATUS_LABELS,
  TICKET_TYPE_LABELS,
  URGENCY_LABELS,
} from '@ticketing/shared';

/** Libellés lisibles des actions du journal d'audit. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'ticket.created': 'a créé le ticket',
  'ticket.updated': 'a modifié le ticket',
  'ticket.status_changed': 'a changé le statut',
  'comment.created': 'a ajouté un commentaire',
};

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
  assigneeId: 'Assigné',
  status: 'Statut',
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  type: TICKET_TYPE_LABELS,
  component: COMPONENT_LABELS,
  environment: ENVIRONMENT_LABELS,
  impact: IMPACT_LABELS,
  urgency: URGENCY_LABELS,
  status: STATUS_LABELS,
};

/** Rend lisible une valeur du journal d'audit ; `names` résout les identifiants d'utilisateurs. */
export function formatAuditValue(field: string, value: unknown, names: Map<string, string>): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (field === 'assigneeId') return names.get(String(value)) ?? 'un agent';
  return VALUE_LABELS[field]?.[String(value)] ?? String(value);
}
