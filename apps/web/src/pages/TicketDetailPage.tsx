import { useQuery } from '@tanstack/react-query';
import { COMPONENT_LABELS, ENVIRONMENT_LABELS, TICKET_TYPE_LABELS } from '@ticketing/shared';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuditTrail } from '../components/AuditTrail';
import { Conversation } from '../components/Conversation';
import { TicketSidebar } from '../components/TicketSidebar';
import { ErrorMessage, formatDate, PriorityBadge, Spinner, StatusBadge } from '../components/ui';

export function TicketDetailPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();

  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: () => api.ticket(id) });
  const comments = useQuery({ queryKey: ['ticket', id, 'comments'], queryFn: () => api.comments(id) });
  const audit = useQuery({
    queryKey: ['ticket', id, 'audit'],
    queryFn: () => api.audit(id),
    enabled: can('audit:read'),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: api.agents,
    enabled: can('ticket:assign'),
    staleTime: 5 * 60_000,
  });

  const names = useMemo(() => new Map((agents.data ?? []).map((a) => [a.id, a.name])), [agents.data]);

  if (ticket.isPending) return <Spinner />;
  if (ticket.error || !ticket.data) {
    return (
      <>
        <ErrorMessage error={ticket.error} />
        <Link to="/tickets">← Retour aux tickets</Link>
      </>
    );
  }

  const t = ticket.data;
  return (
    <>
      <Link to="/tickets" className="back">
        ← Tickets
      </Link>
      <header className="ticket-header">
        <h1>
          <span className="muted">#{t.id}</span> {t.subject}
        </h1>
        <div className="ticket-meta">
          <PriorityBadge priority={t.priority} />
          <StatusBadge status={t.status} />
          <span>{TICKET_TYPE_LABELS[t.type]}</span>
          {t.component && <span>· {COMPONENT_LABELS[t.component]}</span>}
          {t.environment && <span>· {ENVIRONMENT_LABELS[t.environment]}</span>}
          <span className="muted">
            · ouvert par {t.requester.name} le {formatDate(t.createdAt)}
          </span>
        </div>
      </header>

      <div className="ticket-layout">
        <TicketSidebar ticket={t} agents={agents.data ?? []} />
        <div className="ticket-main">
          <section className="card">
            <h2>Description</h2>
            <p className="prewrap">{t.description}</p>
          </section>
          <ErrorMessage error={comments.error} />
          {comments.data && <Conversation ticketId={t.id} comments={comments.data} readOnly={t.status === 'CLOSED'} />}
          {audit.data && <AuditTrail entries={audit.data} names={names} />}
        </div>
      </div>
    </>
  );
}
