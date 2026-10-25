import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { Comment } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage, formatDate } from './ui';

interface Props {
  ticketId: number;
  comments: Comment[];
  /** Un ticket clôturé n'accepte plus de commentaire. */
  readOnly: boolean;
}

export function Conversation({ ticketId, comments, readOnly }: Props) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [isInternal, setIsInternal] = useState(false);

  const add = useMutation({
    mutationFn: () => api.addComment(ticketId, body, isInternal),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (body.trim()) add.mutate();
  }

  return (
    <section className="card">
      <h2>Conversation</h2>
      {comments.length === 0 ? (
        <p className="muted">Aucun commentaire pour l'instant.</p>
      ) : (
        <ol className="comments">
          {comments.map((c) => (
            <li key={c.id} className={c.isInternal ? 'comment internal' : 'comment'}>
              <div className="comment-meta">
                <strong>{c.author.name}</strong>
                {c.isInternal && <span className="badge internal-badge">Note interne</span>}
                <span className="muted small">{formatDate(c.createdAt)}</span>
              </div>
              <p className="prewrap">{c.body}</p>
            </li>
          ))}
        </ol>
      )}

      {!readOnly && can('comment:create') && (
        <form className="composer" onSubmit={onSubmit}>
          <ErrorMessage error={add.error} />
          <textarea
            aria-label="Votre message"
            placeholder={isInternal ? 'Note visible uniquement par le support' : 'Répondre au demandeur'}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={isInternal ? 'internal' : undefined}
          />
          <div className="actions">
            {can('comment:internal') && (
              <label className="checkbox">
                <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
                Note interne
              </label>
            )}
            <button type="submit" className="primary" disabled={add.isPending || !body.trim()}>
              {isInternal ? 'Ajouter la note' : 'Envoyer'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
