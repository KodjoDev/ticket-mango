import { useMutation, useQueryClient } from '@tanstack/react-query';
import { computePriority, DEFAULT_TICKET_TYPE } from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import type { User } from '../api/types';
import { useAuth, useCurrentUser } from '../auth/AuthContext';
import { QualificationFields, type QualificationValues } from '../components/QualificationFields';
import { RequesterPicker } from '../components/Requester';
import { Avatar, ErrorMessage, Field, PriorityBadge } from '../components/ui';
import { useConfig } from '../config/ConfigContext';

export function TicketNewPage() {
  const { can } = useAuth();
  const user = useCurrentUser();
  const config = useConfig();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Seul le support qualifie l'impact, l'urgence et les tags ; l'API refuse ces champs pour un utilisateur externe.
  const canQualify = can('ticket:qualify');

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  // Un agent peut saisir le ticket pour le compte d'un client ; par défaut, il en est le demandeur.
  const [requester, setRequester] = useState<User>(user);
  const [pickingRequester, setPickingRequester] = useState(false);
  const [values, setValues] = useState<QualificationValues>({
    type: DEFAULT_TICKET_TYPE,
    component: null,
    environment: null,
    impact: 'INDIVIDUAL',
    urgency: 'MEDIUM',
    tagIds: [],
  });

  const create = useMutation({
    mutationFn: () => {
      const { impact, urgency, tagIds, ...lists } = values;
      return api.createTicket({
        subject,
        description,
        ...lists,
        ...(canQualify && { impact, urgency, tagIds }),
        ...(requester.id !== user.id && { requesterId: requester.id }),
      });
    },
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['views'] });
      navigate(`/tickets/${ticket.id}`);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <>
      <header className="page-header">
        <h1>Nouveau ticket</h1>
      </header>
      <form className="card form" onSubmit={onSubmit}>
        <ErrorMessage error={create.error} />
        {canQualify && (
          <div className="field">
            <span className="field-label">Demandeur</span>
            {pickingRequester ? (
              <RequesterPicker
                onSelect={(u) => {
                  setRequester(u);
                  setPickingRequester(false);
                }}
                onCancel={() => setPickingRequester(false)}
              />
            ) : (
              <div className="requester">
                <Avatar name={requester.name} size="sm" />
                <span>
                  {requester.name} <span className="muted small">{requester.email}</span>
                  {requester.id === user.id && <span className="muted small"> (vous)</span>}
                </span>
                <button type="button" className="link" onClick={() => setPickingRequester(true)}>
                  Changer
                </button>
              </div>
            )}
          </div>
        )}
        <Field label="Sujet">
          <input required maxLength={250} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Description">
          <textarea required rows={8} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid-3">
          <QualificationFields
            values={values}
            onChange={(change) => setValues((v) => ({ ...v, ...change }))}
            supportFields={canQualify}
          />
          {canQualify && (
            <div className="field">
              <span className="field-label">Priorité calculée</span>
              <div className="priority-preview">
                <PriorityBadge priority={computePriority(values.impact, values.urgency, config.priorityMatrix)} />
              </div>
            </div>
          )}
        </div>
        <div className="actions">
          <button type="button" onClick={() => navigate(-1)}>
            Annuler
          </button>
          <button type="submit" className="primary" disabled={create.isPending}>
            {create.isPending ? 'Création…' : 'Créer le ticket'}
          </button>
        </div>
      </form>
    </>
  );
}
