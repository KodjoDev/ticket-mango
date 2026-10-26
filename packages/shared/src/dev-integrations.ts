/**
 * Intégrations avec les outils de développement (CdC §4.2) : Jira et GitHub.
 */
import type { TicketStatus } from './workflow';

export const DEV_PROVIDERS = ['JIRA', 'GITHUB'] as const;
export type DevProviderName = (typeof DEV_PROVIDERS)[number];

export const DEV_PROVIDER_LABELS: Record<DevProviderName, string> = { JIRA: 'Jira', GITHUB: 'GitHub' };

/** Statuts de ticket que l'équipe de développement peut déclencher. */
export const DEV_SYNC_STATUSES = ['SENT_TO_DEV', 'IN_PROGRESS', 'IN_QA', 'READY_FOR_RELEASE'] as const satisfies readonly TicketStatus[];
export type DevSyncStatus = (typeof DEV_SYNC_STATUSES)[number];

/**
 * Correspondance par défaut : statut de l'issue (en minuscules) → statut du ticket.
 * Pour GitHub, le statut est le libellé d'une étiquette de l'issue, à défaut son état (open / closed).
 */
export const DEFAULT_STATUS_MAPS: Record<DevProviderName, Record<string, DevSyncStatus>> = {
  JIRA: {
    'to do': 'SENT_TO_DEV',
    open: 'SENT_TO_DEV',
    backlog: 'SENT_TO_DEV',
    'in progress': 'IN_PROGRESS',
    'in review': 'IN_QA',
    'in qa': 'IN_QA',
    qa: 'IN_QA',
    recette: 'IN_QA',
    done: 'READY_FOR_RELEASE',
    closed: 'READY_FOR_RELEASE',
    resolved: 'READY_FOR_RELEASE',
  },
  GITHUB: {
    open: 'SENT_TO_DEV',
    'in progress': 'IN_PROGRESS',
    'in review': 'IN_QA',
    recette: 'IN_QA',
    closed: 'READY_FOR_RELEASE',
  },
};

/** Normalise un statut externe pour la recherche dans la table de correspondance. */
export const normalizeExternalStatus = (status: string) => status.trim().toLowerCase();
