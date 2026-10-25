/**
 * Taxonomie des tickets (CdC §3.1).
 * Les valeurs des listes (types, modules, environnements) sont administrables et
 * stockées en base (FieldOption) ; seules leurs clés circulent dans l'API.
 */

export const OPTION_FIELDS = ['TYPE', 'COMPONENT', 'ENVIRONMENT'] as const;
export type OptionField = (typeof OPTION_FIELDS)[number];

export const OPTION_FIELD_LABELS: Record<OptionField, string> = {
  TYPE: 'Types de demande',
  COMPONENT: 'Modules',
  ENVIRONMENT: 'Environnements',
};

/** Champ du ticket qui porte la clé de chaque liste. */
export const OPTION_FIELD_TICKET_KEY = {
  TYPE: 'type',
  COMPONENT: 'component',
  ENVIRONMENT: 'environment',
} as const satisfies Record<OptionField, string>;

/** Clés de type dont dépend le comportement de l'application : renommables, jamais archivées. */
export const SYSTEM_TYPE_KEYS = {
  bug: 'BUG',
  question: 'QUESTION',
  majorIncident: 'MAJOR_INCIDENT',
} as const;

export const DEFAULT_TICKET_TYPE = SYSTEM_TYPE_KEYS.question;

/** Une clé est un code stable en majuscules (ex. BILLING, MOBILE_APP). */
export const OPTION_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,39}$/;
