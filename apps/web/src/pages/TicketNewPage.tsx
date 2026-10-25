import { useMutation, useQueryClient } from '@tanstack/react-query';
import { computePriority, DEFAULT_TICKET_TYPE } from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { QualificationFields, type QualificationValues } from '../components/QualificationFields';
import { ErrorMessage, Field, PriorityBadge } from '../components/ui';
import { useConfig } from '../config/ConfigContext';

export function TicketNewPage() {
  const { can } = useAuth();
  const config = useConfig();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Seul le support qualifie l'impact, l'urgence et les tags ; l'API refuse ces champs pour un utilisateur externe.
  const canQualify = can('ticket:qualify');

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
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
      return api.createTicket({ subject, description, ...lists, ...(canQualify && { impact, urgency, tagIds }) });
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
