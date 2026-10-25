import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { renderMacro, SYSTEM_MACRO_KEYS } from '@ticketing/shared';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import type { Meeting } from '../api/types';
import { useAuth, useCurrentUser } from '../auth/AuthContext';
import { AuditTrail } from '../components/AuditTrail';
import { Conversation, type Draft } from '../components/Conversation';
import { MeetingsCard } from '../components/Meetings';
import { AttachmentList, FilePicker } from '../components/Attachments';
import { TagList } from '../components/tags';
import { TicketSidebar } from '../components/TicketSidebar';
import { ErrorMessage, formatDate, PriorityBadge, Spinner, StatusBadge } from '../components/ui';
import { useConfig } from '../config/ConfigContext';
import { macroContext } from '../macroContext';

export function TicketDetailPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const config = useConfig();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: () => api.ticket(id) });
  const comments = useQuery({ queryKey: ['ticket', id, 'comments'], queryFn: () => api.comments(id) });
  const audit = useQuery({
    queryKey: ['ticket', id, 'audit'],
    queryFn: () => api.audit(id),
    enabled: can('audit:read'),
  });
  const meetings = useQuery({ queryKey: ['ticket', id, 'meetings'], queryFn: () => api.meetings(id) });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: api.agents,
    enabled: can('ticket:assign'),
    staleTime: 5 * 60_000,
  });

  const names = useMemo(() => new Map((agents.data ?? []).map((a) => [a.id, a.name])), [agents.data]);

  /** Après un rendez-vous, l'invitation (macro système) est préparée dans la réponse, à relire avant envoi. */
  async function prepareInvitation(meeting: Meeting) {
    if (!ticket.data) return;
    const macros = await queryClient.fetchQuery({ queryKey: ['macros'], queryFn: api.macros, staleTime: 60_000 });
    const key = meeting.status === 'PROPOSED' ? SYSTEM_MACRO_KEYS.meetingProposal : SYSTEM_MACRO_KEYS.meetingScheduled;
    const macro = macros.find((m) => m.systemKey === key);
    if (!macro) return;
    setDraft({
      body: renderMacro(macro.body, macroContext(ticket.data, user.name, meeting)),
      isInternal: macro.isInternal,
      macro,
      version: Date.now(),
    });
  }

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
      {t.mergedInto && (
        <div className="merged-banner" role="status">
          Ce ticket a été fusionné dans le{' '}
          <Link to={`/tickets/${t.mergedInto.id}`}>
            #{t.mergedInto.id} {t.mergedInto.subject}
          </Link>
          .
        </div>
      )}
      <header className="ticket-header">
        <h1>
          <span className="muted">#{t.id}</span> {t.subject}
        </h1>
        <div className="ticket-meta">
          <PriorityBadge priority={t.priority} />
          <StatusBadge status={t.status} />
          <span>{config.label('TYPE', t.type)}</span>
          {t.component && <span>· {config.label('COMPONENT', t.component)}</span>}
          {t.environment && <span>· {config.label('ENVIRONMENT', t.environment)}</span>}
          {t.channel === 'EMAIL' && <span className="badge channel-badge">✉ E-mail</span>}
          <TagList tags={t.tags} />
          {t.awaitingAgent && t.status !== 'RESOLVED' && t.status !== 'CLOSED' && (
            <span className="badge awaiting-badge">Réponse client en attente</span>
          )}
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
            <AttachmentList attachments={t.attachments} />
            {t.status !== 'CLOSED' && can('comment:create') && <AddAttachments ticketId={t.id} />}
          </section>
          <ErrorMessage error={comments.error} />
          {meetings.data && <MeetingsCard ticket={t} meetings={meetings.data} onCreated={(m) => void prepareInvitation(m)} />}
          {comments.data && <Conversation ticket={t} comments={comments.data} meetings={meetings.data ?? []} draft={draft} />}
          {audit.data && <AuditTrail entries={audit.data} names={names} />}
        </div>
      </div>
    </>
  );
}

/** Ajout de pièces jointes à la demande initiale. */
function AddAttachments({ ticketId }: { ticketId: number }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: () => api.addAttachments(ticketId, files),
    onSuccess: () => {
      setFiles([]);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
  });
  return (
    <div className="add-attachments">
      <ErrorMessage error={upload.error} />
      {error && <div className="alert">{error}</div>}
      <FilePicker files={files} onChange={setFiles} onTooLarge={(n) => setError(`Trop volumineux (25 Mo maximum) : ${n.join(', ')}`)} />
      {files.length > 0 && (
        <button type="button" className="primary" disabled={upload.isPending} onClick={() => upload.mutate()}>
          Ajouter {files.length} fichier(s)
        </button>
      )}
    </div>
  );
}
