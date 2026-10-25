/**
 * Gestion des droits (CdC §7.3).
 */

export const ROLES = ['READER', 'AGENT_N1', 'AGENT_N2', 'ADMIN', 'EXTERNAL_USER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  /** Lire tous les tickets (sinon : uniquement ceux dont on est demandeur). */
  'ticket:read:all',
  'ticket:create',
  /** Modifier la qualification (type, module, environnement, impact, urgence). */
  'ticket:qualify',
  /** Forcer une priorité différente de celle de la matrice. */
  'ticket:priority:override',
  'ticket:assign',
  'ticket:transition',
  'comment:create',
  'comment:internal',
  'audit:read',
  'user:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const AGENT_PERMISSIONS: Permission[] = [
  'ticket:read:all',
  'ticket:create',
  'ticket:qualify',
  'ticket:assign',
  'ticket:transition',
  'comment:create',
  'comment:internal',
  'audit:read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  READER: ['ticket:read:all', 'audit:read'],
  AGENT_N1: AGENT_PERMISSIONS,
  AGENT_N2: [...AGENT_PERMISSIONS, 'ticket:priority:override'],
  ADMIN: PERMISSIONS,
  EXTERNAL_USER: ['ticket:create', 'comment:create'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  READER: 'Lecteur',
  AGENT_N1: 'Agent N1',
  AGENT_N2: 'Agent N2',
  ADMIN: 'Administrateur',
  EXTERNAL_USER: 'Utilisateur externe',
};
