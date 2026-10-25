/**
 * Priorisation selon la matrice ITIL Impact × Urgence (CdC §3.2).
 */

export const IMPACTS = ['INDIVIDUAL', 'TEAM', 'ORGANIZATION'] as const;
export type Impact = (typeof IMPACTS)[number];

export const URGENCIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Urgency = (typeof URGENCIES)[number];

/** P0 est la plus haute priorité (incident majeur), P4 la plus basse. */
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'P4'] as const;
export type Priority = (typeof PRIORITIES)[number];

export type PriorityMatrix = Record<Impact, Record<Urgency, Priority>>;

export const DEFAULT_PRIORITY_MATRIX: PriorityMatrix = {
  INDIVIDUAL: { LOW: 'P4', MEDIUM: 'P4', HIGH: 'P3', CRITICAL: 'P2' },
  TEAM: { LOW: 'P4', MEDIUM: 'P3', HIGH: 'P2', CRITICAL: 'P1' },
  ORGANIZATION: { LOW: 'P3', MEDIUM: 'P2', HIGH: 'P1', CRITICAL: 'P0' },
};

export function computePriority(
  impact: Impact,
  urgency: Urgency,
  matrix: PriorityMatrix = DEFAULT_PRIORITY_MATRIX,
): Priority {
  return matrix[impact][urgency];
}

/** Les priorités P0/P1 déclenchent la procédure d'incident majeur (CdC §6.1). */
export function isMajorIncidentPriority(priority: Priority): boolean {
  return priority === 'P0' || priority === 'P1';
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  P0: 'P0 - Incident majeur',
  P1: 'P1 - Critique',
  P2: 'P2 - Haute',
  P3: 'P3 - Moyenne',
  P4: 'P4 - Faible',
};
