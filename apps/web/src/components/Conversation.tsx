import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { renderMacro, STATUS_LABELS } from '@ticketing/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { Comment, Macro, Meeting, Ticket } from '../api/types';
import { useAuth, useCurrentUser } from '../auth/AuthContext';
import { useConfig } from '../config/ConfigContext';
import { currentMeeting, macroContext } from '../macroContext';
import { SpellcheckPanel } from './Spellcheck';
import { Avatar, ErrorMessage, formatDate } from './ui';

/** Brouillon imposé de l'extérieur (ex. invitation après création d'un rendez-vous). */
export interface Draft {
  body: string;
  isInternal: boolean;
  macro?: Macro;
  /** Change à chaque nouveau brouillon, pour l'appliquer même si le texte est identique. */
  version: number;
}

interface Props {
  ticket: Ticket;
  comments: Comment[];
  meetings: Meeting[];
  draft?: Draft | null;
}

function MacroActionsSummary({ macro }: { macro: Macro }) {
  const { tags } = useConfig();
  const parts = [
    macro.actions.status && `statut → ${STATUS_LABELS[macro.actions.status]}`,
    macro.actions.addTagIds?.length &&
      `tags + ${macro.actions.addTagIds.map((id) => tags.find((t) => t.id === id)?.name ?? '?').join(', ')}`,
    macro.actions.assignToMe && 'm’assigner le ticket',
  ].filter(Boolean);
  return parts.length ? <span className="muted small">Actions à l’envoi : {parts.join(' · ')}</span> : null;
}

export function Conversation({ ticket, comments, meetings, draft }: Props) {
  const { can } = useAuth();
  const user = useCurrentUser();
  const config = useConfig();
  const queryClient = useQueryClient();
  const canPublic = can('comment:public');
  const canInternal = can('comment:internal');
  const [body, setBody] = useState('');
  // Un développeur n'écrit que des notes internes.
  const [isInternal, setIsInternal] = useState(!canPublic);
  const [macro, setMacro] = useState<Macro | null>(null);

  const macros = useQuery({ queryKey: ['macros'], queryFn: api.macros, enabled: can('ticket:qualify'), staleTime: 60_000 });

  useEffect(() => {
    if (!draft) return;
    setBody(draft.body);
    setIsInternal(draft.isInternal);
    setMacro(draft.macro ?? null);
  }, [draft]);

  const send = useMutation({
    mutationFn: async (): Promise<unknown> =>
      macro ? api.applyMacro(macro.id, ticket.id, body) : api.addComment(ticket.id, body, isInternal),
    onSuccess: () => {
      setBody('');
      setMacro(null);
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['views'] });
    },
  });

  function pickMacro(m: Macro) {
    setBody(renderMacro(m.body, macroContext(ticket, user.name, currentMeeting(meetings))));
    setIsInternal(m.isInternal);
    setMacro(m);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (body.trim()) send.mutate();
  }

  const readOnly = ticket.status === 'CLOSED';

  return (
    <section className="card">
      <h2>Conversation</h2>
      {comments.length === 0 ? (
        <p className="muted">Aucun commentaire pour l'instant.</p>
      ) : (
        <ol className="comments">
          {comments.map((c) => (
            <li key={c.id} className={c.isInternal ? 'comment internal' : 'comment'}>
              <Avatar name={c.author.name} />
              <div className="comment-body">
                <div className="comment-meta">
                  <strong>{c.author.name}</strong>
                  {c.isInternal && <span className="badge internal-badge">Note interne</span>}
                  <span className="muted small">{formatDate(c.createdAt)}</span>
                </div>
                <p className="prewrap">{c.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {!readOnly && can('comment:create') && (
        <form className={isInternal ? 'composer internal' : 'composer'} onSubmit={onSubmit}>
          {canPublic && canInternal && (
            <div className="composer-tabs" role="tablist" aria-label="Type de message">
              <button type="button" role="tab" aria-selected={!isInternal} disabled={!!macro} onClick={() => setIsInternal(false)}>
                Réponse publique
              </button>
              <button type="button" role="tab" aria-selected={isInternal} disabled={!!macro} onClick={() => setIsInternal(true)}>
                Note interne
              </button>
              {macros.data && macros.data.length > 0 && (
                <select
                  className="macro-select"
                  aria-label="Appliquer une macro"
                  value=""
                  onChange={(e) => {
                    const m = macros.data.find((x) => x.id === e.target.value);
                    if (m) pickMacro(m);
                  }}
                >
                  <option value="">Macros…</option>
                  {macros.data.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {macro && (
            <div className="macro-banner">
              <span>
                Macro <strong>{macro.name}</strong>
              </span>
              <MacroActionsSummary macro={macro} />
              <button type="button" className="link" onClick={() => setMacro(null)}>
                Retirer la macro
              </button>
            </div>
          )}
          <ErrorMessage error={send.error} />
          <textarea
            aria-label="Votre message"
            placeholder={isInternal ? 'Note visible uniquement par le support' : 'Répondre au demandeur'}
            rows={4}
            lang="fr"
            spellCheck
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="actions composer-footer">
            {config.features.spellcheck && <SpellcheckPanel text={body} onChange={setBody} />}
            <button type="submit" className="primary" disabled={send.isPending || !body.trim()}>
              {macro ? 'Envoyer et appliquer' : isInternal ? 'Ajouter la note' : 'Envoyer'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
