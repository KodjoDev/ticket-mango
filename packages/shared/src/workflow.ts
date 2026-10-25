/**
 * Cycle de vie d'un ticket (CdC §4.1).
 * Le CdC regroupe « Résolu / Clôturé » : on les distingue pour permettre la
 * réouverture d'un ticket résolu, alors qu'un ticket clôturé est définitif.
 */

export const TICKET_STATUSES = [
  'NEW',
  'QUALIFYING',
  'SENT_TO_DEV',
  'IN_PROGRESS',
  'IN_QA',
  'READY_FOR_RELEASE',
  'RESOLVED',
  'CLOSED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const STATUS_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  // Clôture directe possible pour les spams et doublons.
  NEW: ['QUALIFYING', 'RESOLVED', 'CLOSED'],
  // Une question peut être résolue sans passer par les développeurs.
  QUALIFYING: ['SENT_TO_DEV', 'RESOLVED', 'CLOSED'],
  // Les développeurs peuvent renvoyer un bug non reproductible en qualification.
  SENT_TO_DEV: ['IN_PROGRESS', 'QUALIFYING'],
  IN_PROGRESS: ['IN_QA', 'SENT_TO_DEV'],
  // Un échec de recette renvoie en correction.
  IN_QA: ['READY_FOR_RELEASE', 'IN_PROGRESS'],
  READY_FOR_RELEASE: ['RESOLVED', 'IN_QA'],
  // Réouverture : retour en qualification.
  RESOLVED: ['CLOSED', 'QUALIFYING'],
  CLOSED: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function isOpenStatus(status: TicketStatus): boolean {
  return status !== 'RESOLVED' && status !== 'CLOSED';
}

export const STATUS_LABELS: Record<TicketStatus, string> = {
  NEW: 'Nouveau / Non qualifié',
  QUALIFYING: 'En cours de qualification',
  SENT_TO_DEV: 'Transmis aux développeurs',
  IN_PROGRESS: 'En cours de correction',
  IN_QA: 'En recette / Validation QA',
  READY_FOR_RELEASE: 'Prêt pour livraison',
  RESOLVED: 'Résolu',
  CLOSED: 'Clôturé',
};
