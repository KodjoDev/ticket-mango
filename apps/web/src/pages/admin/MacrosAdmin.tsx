import { useQuery } from '@tanstack/react-query';
import {
  MACRO_VARIABLES,
  renderMacro,
  STATUS_LABELS,
  TICKET_STATUSES,
  unknownVariables,
  type MacroActions,
  type MacroContext,
  type TicketStatus,
} from '@ticketing/shared';
import { useRef, useState, type FormEvent } from 'react';
import { adminApi } from '../../api/client';
import type { Macro } from '../../api/types';
import { TagPicker } from '../../components/tags';
import { ErrorMessage, Field, Spinner } from '../../components/ui';
import { useConfig } from '../../config/ConfigContext';
import { move, OrderButtons, useAdminMutation } from './common';

const MACROS_KEY = ['admin', 'macros'];

/** Dans `days` jours, à `hour` heures (heure locale). */
function daysAhead(days: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Données fictives de l'aperçu. */
const PREVIEW: MacroContext = {
  ticket: { id: 1042, subject: 'Export CSV vide' },
  requester: { name: 'Claire Lefèvre' },
  agent: { name: 'Nadia Benali' },
  meeting: {
    url: 'https://meet.google.com/abc-defg-hij',
    startsAt: daysAhead(2, 14),
    durationMinutes: 30,
    participants: ['Claire Lefèvre', 'Hugo Martin', 'Nadia Benali'],
    bookingUrl: 'https://support.example.com/book/…',
    slots: [daysAhead(1, 10), daysAhead(2, 14)],
  },
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

function MacroForm({ macro, onDone }: { macro?: Macro; onDone: () => void }) {
  const config = useConfig();
  const [name, setName] = useState(macro?.name ?? '');
  const [body, setBody] = useState(macro?.body ?? '');
  const [isInternal, setIsInternal] = useState(macro?.isInternal ?? false);
  const [status, setStatus] = useState<TicketStatus | ''>(macro?.actions.status ?? '');
  const [tagIds, setTagIds] = useState<string[]>(macro?.actions.addTagIds ?? []);
  const [assignToMe, setAssignToMe] = useState(macro?.actions.assignToMe ?? false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const isSystem = !!macro?.systemKey;
  const unknown = unknownVariables(body);

  const save = useAdminMutation(
    (input: { name: string; body: string; isInternal: boolean; actions: MacroActions }) =>
      macro ? adminApi.updateMacro(macro.id, input) : adminApi.createMacro(input),
    [MACROS_KEY, ['macros']],
  );

  /** Insère une variable à la position du curseur. */
  function insert(variable: string) {
    const el = textarea.current;
    const token = `{{${variable}}}`;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const actions: MacroActions = {
      ...(status && { status }),
      ...(tagIds.length > 0 && { addTagIds: tagIds }),
      ...(assignToMe && { assignToMe: true }),
    };
    save.mutate({ name: name.trim(), body, isInternal, actions }, { onSuccess: onDone });
  }

  return (
    <form className="card macro-form" onSubmit={onSubmit}>
      <h2>{macro ? `Modifier « ${macro.name} »` : 'Nouvelle macro'}</h2>
      {isSystem && (
        <p className="muted small">
          Macro système : préremplie automatiquement après une prise de rendez-vous. Son texte et son nom sont modifiables.
        </p>
      )}
      <ErrorMessage error={save.error} />
      <Field label="Nom">
        <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="macro-editor">
        <div>
          <Field label="Texte">
            <textarea ref={textarea} required rows={12} lang="fr" spellCheck value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {unknown.length > 0 && (
            <div className="alert">Variable(s) inconnue(s) : {unknown.map((v) => `{{${v}}}`).join(', ')}</div>
          )}
          <div className="variables">
            <span className="field-label">Insérer une variable :</span>
            {MACRO_VARIABLES.map((v) => (
              <button key={v.key} type="button" className="variable" title={v.label} onClick={() => insert(v.key)}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="field-label">Aperçu (données d'exemple)</span>
          <div className={isInternal ? 'macro-preview internal' : 'macro-preview'}>
            <p className="prewrap">{renderMacro(body, PREVIEW) || <span className="muted">—</span>}</p>
          </div>
        </div>
      </div>

      <div className="grid-3">
        <Field label="Type de message">
          <select value={isInternal ? 'internal' : 'public'} onChange={(e) => setIsInternal(e.target.value === 'internal')}>
            <option value="public">Réponse publique au demandeur</option>
            <option value="internal">Note interne</option>
          </select>
        </Field>
        <Field label="Passer le ticket en">
          <select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus | '')}>
            <option value="">Ne pas changer le statut</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <label className="checkbox macro-assign">
          <input type="checkbox" checked={assignToMe} onChange={(e) => setAssignToMe(e.target.checked)} />
          M'assigner le ticket
        </label>
      </div>
      <div className="field">
        <span className="field-label">Ajouter les tags</span>
        <TagPicker choices={config.tagChoices(tagIds)} selected={tagIds} onChange={setTagIds} />
      </div>
      <div className="actions">
        <button type="button" onClick={onDone}>
          Annuler
        </button>
        <button type="submit" className="primary" disabled={save.isPending || unknown.length > 0}>
          Enregistrer
        </button>
      </div>
    </form>
  );
}

export function MacrosAdmin() {
  const { data: macros, error, isPending } = useQuery({ queryKey: MACROS_KEY, queryFn: adminApi.macros });
  const [editing, setEditing] = useState<Macro | 'new' | null>(null);
  const reorder = useAdminMutation(adminApi.reorderMacros, [MACROS_KEY, ['macros']]);
  const update = useAdminMutation(
    ({ id, isActive }: { id: string; isActive: boolean }) => adminApi.updateMacro(id, { isActive }),
    [MACROS_KEY, ['macros']],
  );
  const remove = useAdminMutation(adminApi.deleteMacro, [MACROS_KEY, ['macros']]);

  return (
    <div className="admin-section">
      {editing && (
        <MacroForm key={editing === 'new' ? 'new' : editing.id} macro={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
      )}
      <section className="card">
        <div className="section-header">
          <h2>Macros</h2>
          {!editing && (
            <button type="button" className="primary" onClick={() => setEditing('new')}>
              Nouvelle macro
            </button>
          )}
        </div>
        <p className="muted small">
          Réponses types proposées dans la zone de réponse. Les variables sont remplacées au moment de l'insertion ; l'agent
          peut retoucher le texte avant l'envoi.
        </p>
        <ErrorMessage error={error ?? reorder.error ?? update.error ?? remove.error} />
        {isPending ? (
          <Spinner />
        ) : (
          <ul className="option-list">
            {(macros ?? []).map((m, i, all) => (
              <li key={m.id} className={m.isActive ? 'option-row' : 'option-row inactive'}>
                <OrderButtons
                  index={i}
                  count={all.length}
                  label={m.name}
                  disabled={reorder.isPending}
                  onMove={(d) => reorder.mutate(move(all, i, d).map((x) => x.id))}
                />
                <span className="view-name">
                  <strong>{m.name}</strong>
                  <span className="muted small">
                    {m.isInternal ? 'Note interne' : 'Réponse publique'}
                    {m.actions.status && ` · statut → ${STATUS_LABELS[m.actions.status]}`}
                    {m.actions.addTagIds?.length ? ` · ${m.actions.addTagIds.length} tag(s)` : ''}
                    {m.actions.assignToMe ? ' · assignation' : ''}
                  </span>
                </span>
                <span className="row-actions">
                  {m.systemKey && <span className="badge system-badge">Système</span>}
                  {!m.isActive && <span className="badge archived-badge">Désactivée</span>}
                  <button type="button" className="link" onClick={() => setEditing(m)}>
                    Modifier
                  </button>
                  {!m.systemKey && (
                    <>
                      <button type="button" className="link" onClick={() => update.mutate({ id: m.id, isActive: !m.isActive })}>
                        {m.isActive ? 'Désactiver' : 'Activer'}
                      </button>
                      <button
                        type="button"
                        className="link danger"
                        onClick={() => window.confirm(`Supprimer la macro « ${m.name} » ?`) && remove.mutate(m.id)}
                      >
                        Supprimer
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
