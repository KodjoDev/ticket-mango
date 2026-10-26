import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ALERT_KIND_LABELS, INCIDENT_SEVERITIES, INCIDENT_STATUS_LABELS, INCIDENT_STATUSES, type IncidentSeverity, type IncidentStatus } from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import type { IncidentDetail } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage, Field, formatDate, Spinner } from '../components/ui';

const EVENT_LABELS: Record<string, string> = { opened: 'ouverture', updated: 'mise à jour', resolved: 'résolution' };
const statusBadge = (s: IncidentStatus) => <span className={`badge incident-status ${s.toLowerCase()}`}>{INCIDENT_STATUS_LABELS[s]}</span>;

function useInvalidating<T, V>(fn: (v: V) => Promise<T>, onSuccess?: (r: T) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['incidents'] });
      void queryClient.invalidateQueries({ queryKey: ['public-status'] });
      onSuccess?.(r);
    },
  });
}

function OpenForm() {
  const navigate = useNavigate();
  const [f, setF] = useState({ title: '', severity: 'P0' as IncidentSeverity, message: '', ticketId: '' });
  const open = useInvalidating(
    () => api.openIncident({ title: f.title, severity: f.severity, message: f.message, ticketId: f.ticketId ? Number(f.ticketId) : null }),
    (i) => navigate(`/incidents/${i.id}`),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    open.mutate(undefined);
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2>Activer le mode incident majeur</h2>
      <p className="muted small">Le titre et le message seront publiés sur la status page, visible de tous sans connexion : n’y mettez rien de confidentiel.</p>
      <ErrorMessage error={open.error} />
      <div className="grid-3">
        <Field label="Titre public">
          <input required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Gravité">
          <select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as IncidentSeverity })}>
            {INCIDENT_SEVERITIES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Ticket référent (n°, facultatif)">
          <input type="number" min={1} value={f.ticketId} onChange={(e) => setF({ ...f, ticketId: e.target.value })} />
        </Field>
      </div>
      <Field label="Premier message public">
        <textarea required rows={3} maxLength={2000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
      </Field>
      <div className="actions">
        <button type="submit" className="primary" disabled={open.isPending}>
          Ouvrir l’incident et alerter l’astreinte
        </button>
      </div>
    </form>
  );
}

export function IncidentListPage() {
  const { can } = useAuth();
  const [opening, setOpening] = useState(false);
  const { data, error, isPending } = useQuery({ queryKey: ['incidents', 'list'], queryFn: () => api.incidents() });
  return (
    <>
      <header className="page-header">
        <h1>Incidents majeurs</h1>
        {can('incident:manage') && !opening && (
          <button type="button" className="primary" onClick={() => setOpening(true)}>
            Activer le mode incident
          </button>
        )}
      </header>
      {opening && <OpenForm />}
      <ErrorMessage error={error} />
      {isPending ? (
        <Spinner />
      ) : data?.length === 0 ? (
        <p className="empty">Aucun incident.</p>
      ) : (
        <ul className="mailboxes">
          {data?.map((i) => (
            <li key={i.id} className="mailbox">
              <Link to={`/incidents/${i.id}`}>
                [{i.severity}] {i.title}
              </Link>{' '}
              {statusBadge(i.status)} <span className="muted small">depuis le {formatDate(i.startedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function UpdateForm({ incident }: { incident: IncidentDetail }) {
  const [status, setStatus] = useState<IncidentStatus>(incident.status);
  const [message, setMessage] = useState('');
  const post = useInvalidating(() => api.updateIncident(incident.id, { status, message }), () => setMessage(''));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    post.mutate(undefined);
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2>Publier une mise à jour</h2>
      <ErrorMessage error={post.error} />
      <Field label="Statut">
        <select value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)}>
          {INCIDENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INCIDENT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Message public">
        <textarea required rows={3} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <div className="actions">
        <button type="submit" className="primary" disabled={post.isPending}>
          Publier
        </button>
      </div>
    </form>
  );
}

function BroadcastForm({ incident }: { incident: IncidentDetail }) {
  const [f, setF] = useState({ recipients: '', subject: `Incident : ${incident.title}`, message: '' });
  const send = useInvalidating(() =>
    api.broadcastIncident(incident.id, { recipients: f.recipients.split(/[\s,;]+/).filter(Boolean), subject: f.subject, message: f.message }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate(undefined);
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2>Informer les clients impactés</h2>
      <p className="muted small">Un e-mail par destinataire, sans créer de ticket. Les réponses éventuelles arrivent dans la boîte d’envoi.</p>
      <ErrorMessage error={send.error} />
      {send.data && (
        <p role="status">
          {send.data.delivered
            ? `${send.data.sent} e-mail(s) envoyé(s), ${send.data.failed} en échec.`
            : `SMTP non configuré : ${send.data.sent} message(s) journalisé(s), aucun envoyé.`}
        </p>
      )}
      <Field label="Destinataires (séparés par des virgules ou des retours à la ligne)">
        <textarea required rows={3} value={f.recipients} onChange={(e) => setF({ ...f, recipients: e.target.value })} />
      </Field>
      <Field label="Objet">
        <input required maxLength={200} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
      </Field>
      <Field label="Message">
        <textarea required rows={4} maxLength={5000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
      </Field>
      <div className="actions">
        <button type="submit" className="primary" disabled={send.isPending}>
          Envoyer
        </button>
      </div>
    </form>
  );
}

function PostMortemForm({ incident }: { incident: IncidentDetail }) {
  const [f, setF] = useState({ impact: incident.pmImpact ?? '', rootCause: incident.pmRootCause ?? '', actions: incident.pmActions ?? '' });
  const save = useInvalidating(() =>
    api.savePostMortem(incident.id, { impact: f.impact.trim() || null, rootCause: f.rootCause.trim() || null, actions: f.actions.trim() || null }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined);
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2>Post-mortem (PIR)</h2>
      <p className="muted small">Interne : jamais affiché sur la status page. La chronologie est celle des mises à jour ci-dessus.</p>
      <ErrorMessage error={save.error} />
      <Field label="Impact">
        <textarea rows={3} maxLength={10000} value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value })} />
      </Field>
      <Field label="Causes racines">
        <textarea rows={4} maxLength={10000} value={f.rootCause} onChange={(e) => setF({ ...f, rootCause: e.target.value })} />
      </Field>
      <Field label="Actions préventives">
        <textarea rows={4} maxLength={10000} value={f.actions} onChange={(e) => setF({ ...f, actions: e.target.value })} />
      </Field>
      <div className="actions">
        <button type="submit" className="primary" disabled={save.isPending}>
          Enregistrer
        </button>
      </div>
    </form>
  );
}

export function IncidentDetailPage() {
  const id = useParams().id ?? '';
  const { can } = useAuth();
  const { data: incident, error, isPending } = useQuery({ queryKey: ['incidents', id], queryFn: () => api.incident(id) });
  if (isPending) return <Spinner />;
  if (!incident) return <ErrorMessage error={error} />;
  const manage = can('incident:manage');
  return (
    <>
      <header className="page-header">
        <h1>
          [{incident.severity}] {incident.title}
        </h1>
        {statusBadge(incident.status)}
      </header>
      <p className="muted small">
        <Link to="/incidents">← Tous les incidents</Link>
        {incident.ticket && (
          <>
            {' · '}Ticket référent : <Link to={`/tickets/${incident.ticket.id}`}>#{incident.ticket.id}</Link>
          </>
        )}
        {' · '}Ouvert par {incident.createdBy.name} le {formatDate(incident.startedAt)}
        {incident.resolvedAt && ` · résolu le ${formatDate(incident.resolvedAt)}`}
      </p>

      <section className="card">
        <h2>Chronologie</h2>
        <ol className="incident-timeline">
          {incident.updates.map((u) => (
            <li key={u.id}>
              {statusBadge(u.status)} <span className="muted small">{formatDate(u.createdAt)} · {u.author.name}</span>
              <p>{u.message}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2>Alertes envoyées</h2>
        {incident.deliveries.length === 0 ? (
          <p className="muted small">Aucune alerte externe n’a été envoyée (aucune destination active).</p>
        ) : (
          <ul>
            {incident.deliveries.map((d) => (
              <li key={d.id}>
                {d.ok ? '✓' : '✗'} {d.channel.name} ({ALERT_KIND_LABELS[d.channel.kind]}) — {EVENT_LABELS[d.event] ?? d.event}
                {d.error && <span className="error"> : {d.error}</span>} <span className="muted small">{formatDate(d.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {incident.broadcasts.map((b) => (
          <p key={b.id} className="muted small">
            Diffusion « {b.subject} » : {b.recipients} destinataire(s), {b.delivered ? `${b.sent} envoyé(s), ${b.failed} en échec` : 'journalisée seulement (SMTP absent)'} — {formatDate(b.createdAt)}
          </p>
        ))}
      </section>

      {manage && incident.status !== 'RESOLVED' && <UpdateForm incident={incident} />}
      {manage && <BroadcastForm incident={incident} />}
      {manage && <PostMortemForm key={incident.updates.length} incident={incident} />}
    </>
  );
}
