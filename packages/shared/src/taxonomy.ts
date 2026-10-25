/**
 * Taxonomie des tickets (CdC §3.1).
 * Les valeurs sont identiques aux enums Prisma de l'API : toute modification
 * doit être répercutée dans apps/api/prisma/schema.prisma.
 */

export const TICKET_TYPES = ['BUG', 'FEATURE_REQUEST', 'QUESTION', 'MAJOR_INCIDENT'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const COMPONENTS = ['FRONTEND', 'API', 'DATABASE', 'BILLING', 'AUTH', 'OTHER'] as const;
export type Component = (typeof COMPONENTS)[number];

export const ENVIRONMENTS = ['PRODUCTION', 'STAGING', 'ACCEPTANCE'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  BUG: 'Bug / Incident technique',
  FEATURE_REQUEST: "Demande d'évolution",
  QUESTION: 'Question / Assistance',
  MAJOR_INCIDENT: 'Incident majeur (crise)',
};

export const COMPONENT_LABELS: Record<Component, string> = {
  FRONTEND: 'Frontend',
  API: 'API',
  DATABASE: 'Base de données',
  BILLING: 'Facturation',
  AUTH: 'Authentification',
  OTHER: 'Autre',
};

export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  PRODUCTION: 'Production',
  STAGING: 'Staging / Préprod',
  ACCEPTANCE: 'Recette',
};
