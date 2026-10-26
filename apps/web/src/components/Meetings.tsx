import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDuration } from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { Meeting, Ticket } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage, Field, formatDate } from './ui';
import { copyText } from '../clipboard/copy';

const DURATIONS = [15, 30, 45, 60, 90];
const STATUS: Record<Meeting['status'], string> = {
  PROPOSED: 'En attente du choix du demandeur',
  SCHEDULED: 'Planifié',
  CANCELLED: 'Annulé',
};

/** Valeur d'un <input type="datetime-local"> : heure locale, sans fuseau. */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Créneau suggéré : prochain jour ouvré, à l'heure indiquée. */
function nextWorkingDay(offset: number, hour: number): string {
  const d = new Date();
  let added = 0;
  while (added < offset) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  d.setHours(hour, 0, 0, 0);
  return localInput(d);
}

function MeetingForm({ ticket, onCreated, onCancel }: { ticket: Ticket; onCreated: (m: Meeting) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'direct' | 'proposal'>('direct');
  const [duration, setDuration] = useState(30);
  const [slots, setSlots] = useState([nextWorkingDay(1, 10), nextWorkingDay(1, 14), nextWorkingDay(2, 10)]);
  const [developerIds, setDeveloperIds] = useState<string[]>([]);
  const developers = useQuery({ queryKey: ['developers'], queryFn: api.developers, staleTime: 5 * 60_000 });

  const create = useMutation({
    mutationFn: () =>
      api.createMeeting(ticket.id, {
        mode,
        durationMinutes: duration,
        // datetime-local est en heure locale : new Date() la convertit en instant UTC.
        slots: (mode === 'direct' ? slots.slice(0, 1) : slots).filter(Boolean).map((s) => new Date(s).toISOString()),
        developerIds,
      }),
    onSuccess: (meeting) => {
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] });
      onCreated(meeting);
    },
  });

  const visibleSlots = mode === 'direct' ? slots.slice(0, 1) : slots;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <form className="meeting-form" onSubmit={onSubmit}>
      <div className="segmented" role="tablist" aria-label="Mode de planification">
        <button type="button" role="tab" aria-selected={mode === 'direct'} onClick={() => setMode('direct')}>
          Fixer un créneau
        </button>
        <button type="button" role="tab" aria-selected={mode === 'proposal'} onClick={() => setMode('proposal')}>
          Proposer des créneaux
        </button>
      </div>
      <p className="muted small">
        {mode === 'direct'
          ? 'Le lien Meet est créé immédiatement. Une invitation est préparée dans la réponse au demandeur.'
          : 'Le demandeur reçoit un lien pour choisir parmi vos créneaux ; le Meet est créé à son choix.'}
      </p>
      <ErrorMessage error={create.error} />
      {visibleSlots.map((slot, i) => (
        <div key={i} className="slot-row">
          <Field label={mode === 'direct' ? 'Date et heure' : `Créneau ${i + 1}`}>
            <input
              type="datetime-local"
              required={i < (mode === 'direct' ? 1 : 2)}
              value={slot}
              onChange={(e) => setSlots(slots.map((s, j) => (j === i ? e.target.value : s)))}
            />
          </Field>
          {mode === 'proposal' && slots.length > 2 && (
            <button type="button" className="link danger" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>
              Retirer
            </button>
          )}
        </div>
      ))}
      {mode === 'proposal' && slots.length < 5 && (
        <button type="button" className="link" onClick={() => setSlots([...slots, nextWorkingDay(slots.length, 11)])}>
          + Ajouter un créneau
        </button>
      )}
      <Field label="Durée">
        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          {DURATIONS.map((d) => (
            <option key={d} value={d}>
              {formatDuration(d)}
            </option>
          ))}
        </select>
      </Field>
      <fieldset className="developer-picker">
        <legend className="field-label">Développeurs invités</legend>
        {developers.data?.length === 0 && <p className="muted small">Aucun compte Développeur actif.</p>}
        {developers.data?.map((d) => (
          <label key={d.id} className="checkbox">
            <input
              type="checkbox"
              checked={developerIds.includes(d.id)}
              onChange={(e) => setDeveloperIds(e.target.checked ? [...developerIds, d.id] : developerIds.filter((x) => x !== d.id))}
            />
            {d.name}
          </label>
        ))}
      </fieldset>
      <div className="actions">
        <button type="button" onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" className="primary" disabled={create.isPending}>
          {mode === 'direct' ? 'Créer le Meet' : 'Proposer les créneaux'}
        </button>
      </div>
    </form>
  );
}

function MeetingItem({ meeting, ticketId }: { meeting: Meeting; ticketId: number }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api.cancelMeeting(ticketId, meeting.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] }),
  });
  const [copied, setCopied] = useState(false);

  return (
    <li className={`meeting meeting-${meeting.status.toLowerCase()}`}>
      <div className="meeting-head">
        <strong>{meeting.startsAt ? formatDate(meeting.startsAt) : `${meeting.slots.length} créneaux proposés`}</strong>
        <span className="muted small">
          {STATUS[meeting.status]} · {formatDuration(meeting.durationMinutes)}
        </span>
      </div>
      {meeting.meetUrl && meeting.status === 'SCHEDULED' && (
        <div>
          <a href={meeting.meetUrl} target="_blank" rel="noreferrer">
            {meeting.meetUrl}
          </a>
          {meeting.provider === 'demo' && (
            <span className="badge demo-badge" title="Google Meet n'est pas encore configuré : ce lien est fictif">
              démo
            </span>
          )}
        </div>
      )}
      {meeting.bookingUrl && (
        <button
          type="button"
          className="link"
          onClick={() => void copyText(meeting.bookingUrl!).then((ok) => ok && setCopied(true))}
        >
          {copied ? 'Lien copié' : 'Copier le lien de réservation'}
        </button>
      )}
      <div className="muted small">Participants : {meeting.participants.map((p) => p.name).join(', ')}</div>
      <ErrorMessage error={cancel.error} />
      {meeting.status !== 'CANCELLED' && can('meeting:create') && (
        <button
          type="button"
          className="link danger"
          disabled={cancel.isPending}
          onClick={() => window.confirm('Annuler ce rendez-vous ?') && cancel.mutate()}
        >
          Annuler le rendez-vous
        </button>
      )}
    </li>
  );
}

export function MeetingsCard({
  ticket,
  meetings,
  onCreated,
}: {
  ticket: Ticket;
  meetings: Meeting[];
  onCreated: (meeting: Meeting) => void;
}) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const canPlan = can('meeting:create') && ticket.status !== 'CLOSED';
  if (!canPlan && meetings.length === 0) return null;

  return (
    <section className="card">
      <div className="section-header">
        <h2>Rendez-vous</h2>
        {canPlan && !open && (
          <button type="button" onClick={() => setOpen(true)}>
            Planifier un Meet
          </button>
        )}
      </div>
      {open && (
        <MeetingForm
          ticket={ticket}
          onCancel={() => setOpen(false)}
          onCreated={(m) => {
            setOpen(false);
            onCreated(m);
          }}
        />
      )}
      {meetings.length > 0 && (
        <ul className="meetings">
          {meetings.map((m) => (
            <MeetingItem key={m.id} meeting={m} ticketId={ticket.id} />
          ))}
        </ul>
      )}
    </section>
  );
}
