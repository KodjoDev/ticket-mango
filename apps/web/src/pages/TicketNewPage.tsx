import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  COMPONENT_LABELS,
  COMPONENTS,
  computePriority,
  ENVIRONMENT_LABELS,
  ENVIRONMENTS,
  IMPACT_LABELS,
  IMPACTS,
  TICKET_TYPE_LABELS,
  TICKET_TYPES,
  URGENCIES,
  URGENCY_LABELS,
  type Component,
  type Environment,
  type Impact,
  type TicketType,
  type Urgency,
} from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage, Field, options, PriorityBadge } from '../components/ui';

export function TicketNewPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Seul le support qualifie l'impact et l'urgence ; l'API refuse ces champs pour un utilisateur externe.
  const canQualify = can('ticket:qualify');

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TicketType>('QUESTION');
  const [component, setComponent] = useState<Component | ''>('');
  const [environment, setEnvironment] = useState<Environment | ''>('');
  const [impact, setImpact] = useState<Impact>('INDIVIDUAL');
  const [urgency, setUrgency] = useState<Urgency>('MEDIUM');

  const create = useMutation({
    mutationFn: () =>
      api.createTicket({
        subject,
        description,
        type,
        component: component || null,
        environment: environment || null,
        ...(canQualify && { impact, urgency }),
      }),
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
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
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value as TicketType)}>
              {options(TICKET_TYPES, TICKET_TYPE_LABELS)}
            </select>
          </Field>
          <Field label="Module">
            <select value={component} onChange={(e) => setComponent(e.target.value as Component | '')}>
              <option value="">Non précisé</option>
              {options(COMPONENTS, COMPONENT_LABELS)}
            </select>
          </Field>
          <Field label="Environnement">
            <select value={environment} onChange={(e) => setEnvironment(e.target.value as Environment | '')}>
              <option value="">Non précisé</option>
              {options(ENVIRONMENTS, ENVIRONMENT_LABELS)}
            </select>
          </Field>
        </div>
        {canQualify && (
          <div className="grid-3">
            <Field label="Impact">
              <select value={impact} onChange={(e) => setImpact(e.target.value as Impact)}>
                {options(IMPACTS, IMPACT_LABELS)}
              </select>
            </Field>
            <Field label="Urgence">
              <select value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency)}>
                {options(URGENCIES, URGENCY_LABELS)}
              </select>
            </Field>
            <div className="field">
              <span className="field-label">Priorité calculée</span>
              <div className="priority-preview">
                <PriorityBadge priority={computePriority(impact, urgency)} />
              </div>
            </div>
          </div>
        )}
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
