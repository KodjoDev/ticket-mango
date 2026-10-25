import { useQuery } from '@tanstack/react-query';
import {
  PRIORITIES,
  STATUS_LABELS,
  TICKET_STATUSES,
  type Priority,
  type TicketStatus,
  type ViewFilters,
} from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { adminApi, api } from '../../api/client';
import type { View } from '../../api/types';
import { ErrorMessage, Field, Spinner } from '../../components/ui';
import { useConfig, type ConfigHelpers } from '../../config/ConfigContext';
import { move, OrderButtons, useAdminMutation } from './common';

/** Résumé lisible des filtres d'une vue. */
export function describeFilters(f: ViewFilters, config: ConfigHelpers): string {
  const parts: string[] = [];
  if (f.status === 'open') parts.push('ouverts');
  else if (f.status) parts.push(f.status.map((s) => STATUS_LABELS[s]).join(' ou '));
  else parts.push('tous statuts');
  if (f.priority) parts.push(f.priority.join('/'));
  if (f.type) parts.push(config.label('TYPE', f.type));
  if (f.component) parts.push(config.label('COMPONENT', f.component));
  if (f.assignee === 'me') parts.push("assignés à l'agent connecté");
  else if (f.assignee === 'none') parts.push('non assignés');
  if (f.tagId) parts.push(`tag ${config.tags.find((t) => t.id === f.tagId)?.name ?? '?'}`);
  return parts.join(' · ');
}

type StatusMode = 'open' | 'all' | 'custom';

function ViewForm({ view, onDone }: { view?: View; onDone: () => void }) {
  const config = useConfig();
  const initial = view?.filters ?? { status: 'open' };
  const [name, setName] = useState(view?.name ?? '');
  const [statusMode, setStatusMode] = useState<StatusMode>(
    initial.status === 'open' ? 'open' : initial.status ? 'custom' : 'all',
  );
  const [statuses, setStatuses] = useState<TicketStatus[]>(Array.isArray(initial.status) ? initial.status : []);
  const [priorities, setPriorities] = useState<Priority[]>(initial.priority ?? []);
  const [type, setType] = useState(initial.type ?? '');
  const [component, setComponent] = useState(initial.component ?? '');
  const [assignee, setAssignee] = useState(initial.assignee ?? '');
  const [tagId, setTagId] = useState(initial.tagId ?? '');

  const save = useAdminMutation((input: { name: string; filters: ViewFilters }) =>
    view ? adminApi.updateView(view.id, input) : adminApi.createView(input),
  );

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const filters: ViewFilters = {
      ...(statusMode === 'open' && { status: 'open' as const }),
      ...(statusMode === 'custom' && statuses.length > 0 && { status: statuses }),
      ...(priorities.length > 0 && { priority: priorities }),
      ...(type && { type }),
      ...(component && { component }),
      ...(assignee && { assignee }),
      ...(tagId && { tagId }),
    };
    save.mutate({ name: name.trim(), filters }, { onSuccess: onDone });
  }

  return (
    <form className="card view-form" onSubmit={onSubmit}>
      <h2>{view ? `Modifier « ${view.name} »` : 'Nouvelle vue'}</h2>
      <ErrorMessage error={save.error} />
      <Field label="Nom">
        <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid-4">
        <Field label="Statut">
          <select value={statusMode} onChange={(e) => setStatusMode(e.target.value as StatusMode)}>
            <option value="open">Ouverts</option>
            <option value="all">Tous</option>
            <option value="custom">Choisir…</option>
          </select>
        </Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Tous</option>
            {config.choices('TYPE', type).map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Module">
          <select value={component} onChange={(e) => setComponent(e.target.value)}>
            <option value="">Tous</option>
            {config.choices('COMPONENT', component).map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assignation">
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Toutes</option>
            <option value="me">Agent connecté</option>
            <option value="none">Non assignés</option>
          </select>
        </Field>
      </div>
      {statusMode === 'custom' && (
        <fieldset className="checks">
          <legend className="field-label">Statuts</legend>
          {TICKET_STATUSES.map((s) => (
            <label key={s} className="checkbox">
              <input type="checkbox" checked={statuses.includes(s)} onChange={() => setStatuses(toggle(statuses, s))} />
              {STATUS_LABELS[s]}
            </label>
          ))}
        </fieldset>
      )}
      <fieldset className="checks">
        <legend className="field-label">Priorités (aucune = toutes)</legend>
        {PRIORITIES.map((p) => (
          <label key={p} className="checkbox">
            <input type="checkbox" checked={priorities.includes(p)} onChange={() => setPriorities(toggle(priorities, p))} />
            {p}
          </label>
        ))}
      </fieldset>
      {config.tags.length > 0 && (
        <Field label="Tag">
          <select value={tagId} onChange={(e) => setTagId(e.target.value)}>
            <option value="">Tous</option>
            {config.tagChoices(tagId ? [tagId] : []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="actions">
        <button type="button" onClick={onDone}>
          Annuler
        </button>
        <button type="submit" className="primary" disabled={save.isPending}>
          Enregistrer
        </button>
      </div>
    </form>
  );
}

export function ViewsAdmin() {
  const config = useConfig();
  const { data: views, error, isPending } = useQuery({ queryKey: ['views'], queryFn: api.views });
  const [editing, setEditing] = useState<View | 'new' | null>(null);
  const reorder = useAdminMutation(adminApi.reorderViews);
  const remove = useAdminMutation(adminApi.deleteView);

  return (
    <div className="admin-section">
      {editing && <ViewForm key={editing === 'new' ? 'new' : editing.id} view={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      <section className="card">
        <div className="section-header">
          <h2>Vues de la barre latérale</h2>
          {!editing && (
            <button type="button" className="primary" onClick={() => setEditing('new')}>
              Nouvelle vue
            </button>
          )}
        </div>
        <p className="muted small">Les vues sont partagées par tout le support, dans l'ordre ci-dessous.</p>
        <ErrorMessage error={error ?? reorder.error ?? remove.error} />
        {isPending ? (
          <Spinner />
        ) : (
          <ul className="option-list">
            {(views ?? []).map((v, i, all) => (
              <li key={v.id} className="option-row">
                <OrderButtons
                  index={i}
                  count={all.length}
                  label={v.name}
                  disabled={reorder.isPending}
                  onMove={(d) => reorder.mutate(move(all, i, d).map((x) => x.id))}
                />
                <span className="view-name">
                  <strong>{v.name}</strong>
                  <span className="muted small">{describeFilters(v.filters, config)}</span>
                </span>
                <span className="row-actions">
                  <button type="button" className="link" onClick={() => setEditing(v)}>
                    Modifier
                  </button>
                  <button
                    type="button"
                    className="link danger"
                    onClick={() => window.confirm(`Supprimer la vue « ${v.name} » ?`) && remove.mutate(v.id)}
                  >
                    Supprimer
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
