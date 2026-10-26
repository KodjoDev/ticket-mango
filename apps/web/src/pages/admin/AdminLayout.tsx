import type { Permission } from '@ticketing/shared';
import { Navigate, NavLink, Outlet } from 'react-router';
import { useAuth } from '../../auth/AuthContext';

export const ADMIN_SECTIONS: { path: string; label: string; permission: Permission }[] = [
  { path: 'users', label: 'Utilisateurs', permission: 'user:manage' },
  { path: 'mail', label: 'Messagerie', permission: 'settings:manage' },
  { path: 'alerts', label: 'Alertes', permission: 'settings:manage' },
  { path: 'dev', label: 'Développement', permission: 'settings:manage' },
  { path: 'groups', label: 'Groupes', permission: 'settings:manage' },
  { path: 'routing', label: 'Routage', permission: 'settings:manage' },
  { path: 'sla', label: 'SLA', permission: 'settings:manage' },
  { path: 'qualification', label: 'Qualification', permission: 'settings:manage' },
  { path: 'priority', label: 'Matrice de priorité', permission: 'settings:manage' },
  { path: 'tags', label: 'Tags', permission: 'settings:manage' },
  { path: 'layout', label: 'Mise en page', permission: 'settings:manage' },
  { path: 'views', label: 'Vues', permission: 'settings:manage' },
  { path: 'macros', label: 'Macros', permission: 'settings:manage' },
];

export function AdminLayout() {
  const { can } = useAuth();
  const sections = ADMIN_SECTIONS.filter((s) => can(s.permission));
  if (sections.length === 0) return <Navigate to="/tickets" replace />;

  return (
    <>
      <header className="page-header">
        <h1>Administration</h1>
      </header>
      <nav className="tabs" aria-label="Sections d'administration">
        {sections.map((s) => (
          <NavLink key={s.path} to={`/admin/${s.path}`}>
            {s.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}

/** Première section accessible, pour /admin. */
export function AdminIndex() {
  const { can } = useAuth();
  const first = ADMIN_SECTIONS.find((s) => can(s.permission));
  return <Navigate to={first ? `/admin/${first.path}` : '/tickets'} replace />;
}

/** Garde d'une section : redirige si la permission manque (accès direct par URL). */
export function RequirePermission({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { can } = useAuth();
  return can(permission) ? <>{children}</> : <Navigate to="/admin" replace />;
}
