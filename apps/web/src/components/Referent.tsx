import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { TicketDetail } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage, PriorityBadge, StatusBadge } from './ui';

/** Rattachement à un ticket référent (« ticket problème ») et liste des tickets liés. */
export function ReferentCard({ ticket }: { ticket: TicketDetail }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const canEdit = can('ticket:qualify') && ticket.status !== 'CLOSED';

  const link = useMutation({
    mutationFn: (parentId: number | null) => api.setParent(ticket.id, parentId),
    onSuccess: (updated, parentId) => {
      queryClient.setQueryData(['ticket', ticket.id], updated);
      setInput('');
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id, 'audit'] });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      const previous = ticket.parent?.id;
      for (const id of [previous, parentId]) if (id) void queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    },
  });

  if (!canEdit && !ticket.parent && ticket.children.length === 0) return null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const id = Number(input.replace('#', '').trim());
    if (Number.isInteger(id) && id > 0) link.mutate(id);
  }

  return (
    <section className="card">
      <h2>Ticket référent</h2>
      <ErrorMessage error={link.error} />
      {ticket.parent ? (
        <div className="referent-parent">
          <span>
            Rattaché au{' '}
            <Link to={`/tickets/${ticket.parent.id}`}>
              #{ticket.parent.id} {ticket.parent.subject}
            </Link>
          </span>
          <StatusBadge status={ticket.parent.status} />
          {canEdit && (
            <button type="button" className="link" disabled={link.isPending} onClick={() => link.mutate(null)}>
              Détacher
            </button>
          )}
        </div>
      ) : ticket.children.length > 0 ? (
        <>
          <p className="muted small">Ce ticket est le référent de {ticket.children.length} ticket(s) :</p>
          <ul className="children">
            {ticket.children.map((c) => (
              <li key={c.id}>
                <PriorityBadge priority={c.priority} />
                <Link to={`/tickets/${c.id}`}>
                  #{c.id} {c.subject}
                </Link>
                <span className="muted small">{c.requester.name}</span>
                <StatusBadge status={c.status} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        canEdit && (
          <form className="inline-form" onSubmit={onSubmit}>
            <input
              aria-label="Numéro du ticket référent"
              placeholder="N° du référent, ex. 42"
              inputMode="numeric"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" disabled={!input.trim() || link.isPending}>
              Rattacher
            </button>
          </form>
        )
      )}
    </section>
  );
}
