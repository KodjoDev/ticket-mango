import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import type { TicketDetail } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage } from './ui';

/** Fusion d'un doublon dans le ticket à conserver (CdC §2.2). */
export function MergeCard({ ticket }: { ticket: TicketDetail }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState('');
  const merge = useMutation({
    mutationFn: (targetId: number) => api.merge(ticket.id, targetId),
    onSuccess: (kept) => {
      void queryClient.invalidateQueries({ queryKey: ['ticket'] });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      navigate(`/tickets/${kept.id}`);
    },
  });
  if (!can('ticket:qualify') || !can('ticket:transition') || ticket.status === 'CLOSED') return null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const id = Number(target.replace('#', '').trim());
    if (
      Number.isInteger(id) &&
      id > 0 &&
      window.confirm(`Fusionner le ticket #${ticket.id} dans le #${id} ? Ce ticket sera clôturé et son contenu recopié en note interne.`)
    ) {
      merge.mutate(id);
    }
  }

  return (
    <section className="card">
      <h2>Doublon</h2>
      <ErrorMessage error={merge.error} />
      <form className="inline-form" onSubmit={onSubmit}>
        <input
          aria-label="Numéro du ticket à conserver"
          placeholder="Fusionner dans le n°…"
          inputMode="numeric"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <button type="submit" disabled={!target.trim() || merge.isPending}>
          Fusionner
        </button>
      </form>
    </section>
  );
}
