/**
 * Gestion des droits (CdC §7.3).
 */

export const ROLES = ['READER', 'AGENT_N1', 'AGENT_N2', 'ADMIN', 'DEVELOPER', 'EXTERNAL_USER'] as const;
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
  /** Écrire au demandeur ; sans cette permission, seules les notes internes sont possibles. */
  'comment:public',
  'comment:internal',
  'audit:read',
  'user:manage',
  /** Planifier un rendez-vous (Google Meet) depuis un ticket. */
  'meeting:create',
  /** Administrer la qualification, la matrice de priorité, les tags, la mise en page et les vues. */
  'settings:manage',
  /** Ouvrir, mettre à jour et clore un incident majeur, diffuser aux clients, rédiger le post-mortem. */
  'incident:manage',
  /** Préparer, publier et notifier une version de livraison. */
  'release:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const AGENT_PERMISSIONS: Permission[] = [
  'ticket:read:all',
  'ticket:create',
  'ticket:qualify',
  'ticket:assign',
  'ticket:transition',
  'comment:create',
  'comment:public',
  'comment:internal',
  'audit:read',
  'meeting:create',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  READER: ['ticket:read:all', 'audit:read'],
  AGENT_N1: AGENT_PERMISSIONS,
  AGENT_N2: [...AGENT_PERMISSIONS, 'ticket:priority:override', 'incident:manage', 'release:manage'],
  ADMIN: PERMISSIONS,
  // Le développeur suit les tickets et échange avec le support en notes internes, sans qualifier.
  DEVELOPER: ['ticket:read:all', 'comment:create', 'comment:internal', 'audit:read'],
  EXTERNAL_USER: ['ticket:create', 'comment:create', 'comment:public'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  READER: 'Lecteur',
  AGENT_N1: 'Agent N1',
  AGENT_N2: 'Agent N2',
  ADMIN: 'Administrateur',
  DEVELOPER: 'Développeur',
  EXTERNAL_USER: 'Utilisateur externe',
};
