import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEV_PROVIDER_LABELS } from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { TicketDetail } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage } from './ui';

/** Issues Jira / GitHub liées au ticket : création, liaison d'une issue existante, statut et version de correction. */
export function DevLinksCard({ ticket }: { ticket: TicketDetail }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = can('ticket:qualify') && ticket.status !== 'CLOSED';
  const integrations = useQuery({ queryKey: ['dev-integrations'], queryFn: api.devIntegrations, enabled: canEdit });
  const [integrationId, setIntegrationId] = useState('');
  const [reference, setReference] = useState('');
  const selected = integrationId || integrations.data?.[0]?.id || '';

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] });
    void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    void queryClient.invalidateQueries({ queryKey: ['views'] });
  };
  const link = useMutation({
    mutationFn: (ref?: string) => api.linkIssue(ticket.id, selected, ref),
    onSuccess: () => {
      setReference('');
      refresh();
    },
  });
  const unlink = useMutation({ mutationFn: (linkId: string) => api.unlinkIssue(ticket.id, linkId), onSuccess: refresh });

  const choices = integrations.data ?? [];
  if (!can('ticket:read:all') || (ticket.devLinks.length === 0 && (!canEdit || choices.length === 0))) return null;

  function onLink(e: FormEvent) {
    e.preventDefault();
    if (reference.trim()) link.mutate(reference.trim());
  }

  return (
    <section className="card">
      <h2>Développement</h2>
      <ErrorMessage error={link.error ?? unlink.error} />
      {ticket.devLinks.length > 0 && (
        <ul className="dev-links">
          {ticket.devLinks.map((l) => (
            <li key={l.id}>
              <a href={l.url} target="_blank" rel="noreferrer noopener">
                {l.externalKey}
              </a>{' '}
              <span className="muted small">{DEV_PROVIDER_LABELS[l.integration.provider]}</span>
              <div className="small">{l.title}</div>
              <div className="muted small">
                {l.externalStatus ?? '—'}
                {l.fixVersion && ` · corrigé dans ${l.fixVersion}`}
              </div>
              {canEdit && (
                <button type="button" className="link danger" disabled={unlink.isPending} onClick={() => unlink.mutate(l.id)}>
                  Détacher
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && choices.length > 0 && (
        <>
          {choices.length > 1 && (
            <select aria-label="Outil de développement" value={selected} onChange={(e) => setIntegrationId(e.target.value)}>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.project})
                </option>
              ))}
            </select>
          )}
          <div className="link-row">
            <button type="button" disabled={link.isPending} onClick={() => link.mutate(undefined)}>
              {link.isPending ? 'Création…' : "Créer l'issue"}
            </button>
          </div>
          <form className="inline-form" onSubmit={onLink}>
            <input aria-label="Issue existante" placeholder="Lier : clé, n° ou URL" value={reference} onChange={(e) => setReference(e.target.value)} />
            <button type="submit" disabled={link.isPending || !reference.trim()}>
              Lier
            </button>
          </form>
        </>
      )}
    </section>
  );
}
