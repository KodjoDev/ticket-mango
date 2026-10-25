import { ROLE_LABELS } from '@ticketing/shared';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { Avatar, Spinner } from './ui';

/** Garde des routes authentifiées et coque de l'application. */
export function Layout() {
  const { user, logout, can } = useAuth();
  const location = useLocation();

  if (user === undefined) return <Spinner label="Vérification de la session…" />;
  if (user === null) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">M</span>
          Ticket Mango
        </div>
        <nav>
          <NavLink to="/tickets" end>
            Tickets
          </NavLink>
          {can('ticket:create') && <NavLink to="/tickets/new">Nouveau ticket</NavLink>}
        </nav>
        <div className="sidebar-user">
          <Avatar name={user.name} />
          <div className="who">
            <strong>{user.name}</strong>
            <div className="muted small">{ROLE_LABELS[user.role]}</div>
            <button type="button" className="link" onClick={() => void logout()}>
              Se déconnecter
            </button>
          </div>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
