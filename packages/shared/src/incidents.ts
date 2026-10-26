/**
 * Crise P0/P1 (CdC §6) : statuts publics de la status page et destinations d'alerte.
 */

export const INCIDENT_STATUSES = ['INVESTIGATING', 'IDENTIFIED', 'FIXING', 'RESOLVED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  INVESTIGATING: 'Investigation en cours',
  IDENTIFIED: 'Problème identifié',
  FIXING: 'Correctif en cours',
  RESOLVED: 'Résolu',
};

export const INCIDENT_SEVERITIES = ['P0', 'P1'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const ALERT_KINDS = ['SLACK', 'TEAMS', 'PAGERDUTY', 'WEBHOOK'] as const;
export type AlertKindName = (typeof ALERT_KINDS)[number];

export const ALERT_KIND_LABELS: Record<AlertKindName, string> = {
  SLACK: 'Slack',
  TEAMS: 'Microsoft Teams',
  PAGERDUTY: 'PagerDuty',
  WEBHOOK: 'Webhook générique',
};

/** PagerDuty reçoit une clé d'intégration ; les autres destinations reçoivent une URL https. */
export const ALERT_TARGET_IS_KEY: Record<AlertKindName, boolean> = {
  SLACK: false,
  TEAMS: false,
  PAGERDUTY: true,
  WEBHOOK: false,
};
