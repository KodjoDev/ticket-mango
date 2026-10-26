import { useQuery } from "@tanstack/react-query";
import { ROLE_LABELS } from "@ticketing/shared";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useSearchParams,
} from "react-router";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ConfigProvider } from "../config/ConfigContext";
import { isViewActive, viewToParams } from "../filters";
import {
  ClipboardProvider,
  useClipboardHistory,
} from "../clipboard/ClipboardContext";
import { ClipboardPanel } from "./ClipboardPanel";
import { IncidentBanner } from "./IncidentBanner";
import { NotificationBell } from "./Notifications";
import { Avatar, Spinner } from "./ui";

function ViewsNav() {
  const location = useLocation();
  const [params] = useSearchParams();
  const { data: views } = useQuery({
    queryKey: ["views"],
    queryFn: api.views,
    refetchInterval: 60_000,
  });
  if (!views?.length) return null;
  const onList = location.pathname === "/tickets";

  return (
    <div className="views-nav">
      <div className="nav-title">Vues</div>
      {views.map((view) => (
        <Link
          key={view.id}
          to={`/tickets?${viewToParams(view.filters).toString()}`}
          className={
            onList && isViewActive(view.filters, params) ? "active" : undefined
          }
        >
          <span>{view.name}</span>
          <span className="count">{view.count}</span>
        </Link>
      ))}
    </div>
  );
}

/** NavLink ne compare pas la query string : l'état actif est calculé à la main. */
function AllTicketsLink() {
  const location = useLocation();
  const active =
    location.pathname === "/tickets" && location.search === "?status=all";
  return (
    <Link to="/tickets?status=all" className={active ? "active" : undefined}>
      Tous les tickets
    </Link>
  );
}

/** Déconnexion : l'historique des copies est vidé avant de quitter. */
function LogoutButton({ onLogout }: { onLogout: () => Promise<void> }) {
  const { clear } = useClipboardHistory();
  return (
    <button
      type="button"
      className="link"
      onClick={() => {
        clear();
        void onLogout();
      }}
    >
      Se déconnecter
    </button>
  );
}

/** Garde des routes authentifiées et coque de l'application. */
export function Layout() {
  const { user, logout, can } = useAuth();
  const location = useLocation();

  if (user === undefined)
    return <Spinner label="Vérification de la session…" />;
  if (user === null)
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );

  return (
    <ClipboardProvider userId={user.id}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              M
            </span>
            Ticket Mango
            {can("ticket:read:all") && <NotificationBell />}
            <ClipboardPanel />
          </div>
          <nav aria-label="Navigation principale">
            {can("ticket:read:all") ? (
              <ViewsNav />
            ) : (
              <NavLink to="/tickets">Mes demandes</NavLink>
            )}
            <div className="nav-group">
              {can("ticket:read:all") && <AllTicketsLink />}
              {can("report:read") && (
                <NavLink to="/reports">Statistiques</NavLink>
              )}
              {can("ticket:read:all") && (
                <NavLink to="/releases/manage">Versions</NavLink>
              )}
              {can("ticket:read:all") && (
                <NavLink to="/incidents">Incidents majeurs</NavLink>
              )}
              {can("ticket:create") && (
                <NavLink to="/tickets/new">Nouveau ticket</NavLink>
              )}
              {(can("settings:manage") || can("user:manage")) && (
                <NavLink to="/admin">Administration</NavLink>
              )}
            </div>
          </nav>
          <div className="sidebar-user">
            <Avatar name={user.name} />
            <div className="who">
              <strong>{user.name}</strong>
              <div className="muted small">{ROLE_LABELS[user.role]}</div>
              <LogoutButton onLogout={logout} />
            </div>
          </div>
        </aside>
        <main className="content">
          <IncidentBanner />
          <ConfigProvider>
            <Outlet />
          </ConfigProvider>
        </main>
      </div>
    </ClipboardProvider>
  );
}
