import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import type { Notification } from '../api/types';
import { formatDate } from './ui';

const KEY = ['notifications'];

/** Cloche des notifications : assignations, réponses des demandeurs, alertes SLA. */
export function NotificationBell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const { data } = useQuery({ queryKey: KEY, queryFn: api.notifications, refetchInterval: 30_000 });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });
  const markRead = useMutation({ mutationFn: api.markNotificationRead, onSuccess: refresh });
  const markAll = useMutation({ mutationFn: api.markAllNotificationsRead, onSuccess: refresh });

  // Fermeture au clic extérieur ou sur Échap.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => panel.current && !panel.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function openNotification(n: Notification) {
    if (!n.readAt) markRead.mutate(n.id);
    setOpen(false);
    if (n.ticketId) navigate(`/tickets/${n.ticketId}`);
  }

  const unread = data?.unread ?? 0;
  return (
    <div className="bell" ref={panel}>
      <button
        type="button"
        className="bell-button"
        aria-label={unread ? `Notifications (${unread} non lues)` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5-6.71V3.5a2 2 0 0 0-4 0v.79A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
          />
        </svg>
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-header">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" className="link" onClick={() => markAll.mutate()}>
                Tout marquer comme lu
              </button>
            )}
          </div>
          {!data?.items.length ? (
            <p className="muted small bell-empty">Aucune notification.</p>
          ) : (
            <ul>
              {data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`bell-item ${n.readAt ? '' : 'unread'} kind-${n.kind.replace('.', '-')}`}
                    onClick={() => openNotification(n)}
                  >
                    <span>{n.message}</span>
                    <span className="muted small">{formatDate(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
