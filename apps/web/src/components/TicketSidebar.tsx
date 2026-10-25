import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  COMPONENT_LABELS,
  COMPONENTS,
  ENVIRONMENT_LABELS,
  ENVIRONMENTS,
  IMPACT_LABELS,
  IMPACTS,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  STATUS_TRANSITIONS,
  TICKET_TYPE_LABELS,
  TICKET_TYPES,
  URGENCIES,
  URGENCY_LABELS,
  type TicketStatus,
} from '@ticketing/shared';
import { api, ApiError } from '../api/client';
import type { Agent, Ticket, TicketInput } from '../api/types';
import { useAuth, useCurrentUser } from '../auth/AuthContext';
import { ErrorMessage, Field, formatDate, options, PriorityBadge, StatusBadge } from './ui';

/** Libellé du bouton selon la transition (réouverture, renvoi en arrière…). */
function transitionLabel(from: TicketStatus, to: TicketStatus): string {
  if (from === 'RESOLVED' && to === 'QUALIFYING') return 'Rouvrir';
  if (to === 'CLOSED') return 'Clôturer';
  if (to === 'RESOLVED') return 'Résoudre';
  return STATUS_LABELS[to];
}

export function TicketSidebar({ ticket, agents }: { ticket: Ticket; agents: Agent[] }) {
  const { can } = useAuth();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const closed = ticket.status === 'CLOSED';

  const onSuccess = (updated: Ticket) => {
    queryClient.setQueryData(['ticket', ticket.id], updated);
    void queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id, 'audit'] });
    void queryClient.invalidateQueries({ queryKey: ['tickets'] });
  };
  // Conflit (modification concurrente) : on recharge la version à jour.
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 409) {
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] });
    }
  };

  const update = useMutation({ mutationFn: (input: TicketInput) => api.updateTicket(ticket.id, input), onSuccess, onError });
  const transition = useMutation({ mutationFn: (to: TicketStatus) => api.transition(ticket.id, to), onSuccess, onError });

  const canQualify = can('ticket:qualify') && !closed;
  const canAssign = can('ticket:assign') && !closed;
  const nextStatuses = can('ticket:transition') ? STATUS_TRANSITIONS[ticket.status] : [];
  const busy = update.isPending || transition.isPending;

  return (
    <aside className="ticket-side">
      <section className="card">
        <h2>Statut</h2>
        <StatusBadge status={ticket.status} />
        <ErrorMessage error={transition.error} />
        {nextStatuses.length > 0 && (
          <div className="transitions">
            {nextStatuses.map((to) => (
              <button key={to} type="button" disabled={busy} onClick={() => transition.mutate(to)}>
                {transitionLabel(ticket.status, to)}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Qualification</h2>
        <ErrorMessage error={update.error} />
        <fieldset disabled={!canQualify || busy}>
          <Field label="Type">
            <select value={ticket.type} onChange={(e) => update.mutate({ type: e.target.value as Ticket['type'] })}>
              {options(TICKET_TYPES, TICKET_TYPE_LABELS)}
            </select>
          </Field>
          <Field label="Module">
            <select
              value={ticket.component ?? ''}
              onChange={(e) => update.mutate({ component: (e.target.value || null) as Ticket['component'] })}
            >
              <option value="">Non précisé</option>
              {options(COMPONENTS, COMPONENT_LABELS)}
            </select>
          </Field>
          <Field label="Environnement">
            <select
              value={ticket.environment ?? ''}
              onChange={(e) => update.mutate({ environment: (e.target.value || null) as Ticket['environment'] })}
            >
              <option value="">Non précisé</option>
              {options(ENVIRONMENTS, ENVIRONMENT_LABELS)}
            </select>
          </Field>
          <Field label="Impact">
            <select value={ticket.impact} onChange={(e) => update.mutate({ impact: e.target.value as Ticket['impact'] })}>
              {options(IMPACTS, IMPACT_LABELS)}
            </select>
          </Field>
          <Field label="Urgence">
            <select value={ticket.urgency} onChange={(e) => update.mutate({ urgency: e.target.value as Ticket['urgency'] })}>
              {options(URGENCIES, URGENCY_LABELS)}
            </select>
          </Field>
        </fieldset>

        <div className="field">
          <span className="field-label">Priorité</span>
          <div className="priority-row">
            <PriorityBadge priority={ticket.priority} />
            <span className="muted small">{ticket.priorityOverridden ? 'forcée manuellement' : 'calculée (impact × urgence)'}</span>
          </div>
          {can('ticket:priority:override') && !closed && (
            <select
              aria-label="Forcer la priorité"
              disabled={busy}
              value={ticket.priorityOverridden ? ticket.priority : ''}
              onChange={(e) => update.mutate({ priority: (e.target.value || null) as Ticket['priority'] | null })}
            >
              <option value="">Automatique (matrice)</option>
              {options(PRIORITIES, PRIORITY_LABELS)}
            </select>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Assignation</h2>
        {canAssign ? (
          <>
            <select
              aria-label="Agent assigné"
              disabled={busy}
              value={ticket.assignee?.id ?? ''}
              onChange={(e) => update.mutate({ assigneeId: e.target.value || null })}
            >
              <option value="">Non assigné</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {ticket.assignee?.id !== user.id && can('ticket:transition') && (
              <button type="button" className="link" disabled={busy} onClick={() => update.mutate({ assigneeId: user.id })}>
                M'assigner ce ticket
              </button>
            )}
          </>
        ) : (
          <p>{ticket.assignee?.name ?? <span className="muted">Non assigné</span>}</p>
        )}
      </section>

      <section className="card">
        <h2>Dates</h2>
        <dl className="dates">
          <dt>Création</dt>
          <dd>{formatDate(ticket.createdAt)}</dd>
          <dt>Première réponse</dt>
          <dd>{formatDate(ticket.firstResponseAt)}</dd>
          <dt>Résolution</dt>
          <dd>{formatDate(ticket.resolvedAt)}</dd>
          <dt>Clôture</dt>
          <dd>{formatDate(ticket.closedAt)}</dd>
        </dl>
      </section>
    </aside>
  );
}
