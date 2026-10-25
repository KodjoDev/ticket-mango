import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDuration, formatMeetingDate } from '@ticketing/shared';
import { useState } from 'react';
import { useParams } from 'react-router';
import { publicApi } from '../api/client';
import { ErrorMessage, Spinner } from '../components/ui';

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Page de réservation ouverte depuis le lien envoyé au demandeur : aucune connexion requise. */
export function BookingPage() {
  const token = useParams().token ?? '';
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const booking = useQuery({ queryKey: ['booking', token], queryFn: () => publicApi.booking(token), retry: false });
  const book = useMutation({
    mutationFn: (slotId: string) => publicApi.book(token, slotId),
    onSuccess: (data) => queryClient.setQueryData(['booking', token], data),
  });

  const b = booking.data;
  return (
    <div className="login">
      <div className="card booking-card">
        <h1>
          <span className="brand-mark" aria-hidden="true">M</span>
          Prise de rendez-vous
        </h1>
        {booking.isPending && <Spinner />}
        {booking.error && <ErrorMessage error={booking.error} />}
        {b && (
          <>
            <p className="muted">
              Demande #{b.ticket.id} « {b.ticket.subject} » · visio de {formatDuration(b.durationMinutes)} avec{' '}
              {b.participants.join(', ')}.
            </p>

            {b.status === 'SCHEDULED' && b.startsAt && (
              <div className="booking-confirmed" role="status">
                <strong>Rendez-vous confirmé</strong>
                <p>{formatMeetingDate(b.startsAt, timeZone)}</p>
                {b.meetUrl && (
                  <p>
                    <a href={b.meetUrl} target="_blank" rel="noreferrer">
                      Rejoindre la visio
                    </a>
                    {b.provider === 'demo' && <span className="badge demo-badge">démo</span>}
                  </p>
                )}
              </div>
            )}

            {b.status === 'CANCELLED' && <div className="alert">Ce rendez-vous a été annulé par le support.</div>}

            {b.status === 'PROPOSED' &&
              (b.slots.length === 0 ? (
                <div className="alert">Les créneaux proposés sont passés. Répondez au support pour en obtenir d'autres.</div>
              ) : (
                <>
                  <p>Choisissez le créneau qui vous convient :</p>
                  <ErrorMessage error={book.error} />
                  <div className="slot-choices" role="radiogroup" aria-label="Créneaux disponibles">
                    {b.slots.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        role="radio"
                        aria-checked={selected === s.id}
                        className={selected === s.id ? 'slot-choice selected' : 'slot-choice'}
                        onClick={() => setSelected(s.id)}
                      >
                        {formatMeetingDate(s.startsAt, timeZone)}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="primary"
                    disabled={!selected || book.isPending}
                    onClick={() => selected && book.mutate(selected)}
                  >
                    {book.isPending ? 'Réservation…' : 'Confirmer ce créneau'}
                  </button>
                </>
              ))}
          </>
        )}
      </div>
    </div>
  );
}
