import { useQuery } from '@tanstack/react-query';
import { CUSTOM_FIELD_KEY_PATTERN, CUSTOM_FIELD_KIND_LABELS, CUSTOM_FIELD_KINDS, type CustomFieldKind } from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { adminApi } from '../../api/client';
import type { CustomField } from '../../api/types';
import { ErrorMessage, Field, Spinner } from '../../components/ui';
import { useAdminMutation } from './common';

const KEY = ['admin', 'custom-fields'];

/** Clé proposée à partir du libellé : « N° client » → n_client. */
function keyFromLabel(label: string) {
  const key = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(key) ? key.slice(0, 40) : `champ_${key}`.slice(0, 40);
}

function FieldForm({ field, onDone }: { field?: CustomField; onDone: () => void }) {
  const [f, setF] = useState({
    label: field?.label ?? '',
    key: field?.key ?? '',
    kind: (field?.kind ?? 'TEXT') as CustomFieldKind,
    options: (field?.options ?? []).join('\n'),
    required: field?.required ?? false,
    forRequester: field?.forRequester ?? false,
  });
  const [keyTouched, setKeyTouched] = useState(false);
  const choices = f.options.split('\n').map((o) => o.trim()).filter(Boolean);
  const save = useAdminMutation(
    () =>
      field
        ? adminApi.updateCustomField(field.id, {
            label: f.label,
            required: f.required,
            forRequester: f.forRequester,
            ...(field.kind === 'SELECT' && { options: choices }),
          })
        : adminApi.createCustomField({
            key: f.key,
            label: f.label,
            kind: f.kind,
            required: f.kind !== 'CHECKBOX' && f.required,
            forRequester: f.forRequester,
            ...(f.kind === 'SELECT' && { options: choices }),
          }),
    [KEY, ['config']],
  );
  const kind = field?.kind ?? f.kind;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined, { onSuccess: onDone });
  };
  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>{field ? `Modifier ${field.label}` : 'Nouveau champ'}</h2>
      <ErrorMessage error={save.error} />
      <div className="grid-3">
        <Field label="Libellé">
          <input
            required
            maxLength={100}
            value={f.label}
            onChange={(e) => setF({ ...f, label: e.target.value, ...(!field && !keyTouched && { key: keyFromLabel(e.target.value) }) })}
          />
        </Field>
        <Field label="Type">
          <select value={kind} disabled={!!field} onChange={(e) => setF({ ...f, kind: e.target.value as CustomFieldKind })}>
            {CUSTOM_FIELD_KINDS.map((k) => (
              <option key={k} value={k}>
                {CUSTOM_FIELD_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Clé (définitive)">
          <input
            required
            disabled={!!field}
            pattern={CUSTOM_FIELD_KEY_PATTERN.source}
            value={f.key}
            onChange={(e) => {
              setKeyTouched(true);
              setF({ ...f, key: e.target.value });
            }}
          />
        </Field>
      </div>
      {kind === 'SELECT' && (
        <Field label="Choix (un par ligne)">
          <textarea required rows={4} value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} />
        </Field>
      )}
      <div className="actions">
        {kind !== 'CHECKBOX' && (
          <label className="checkbox">
            <input type="checkbox" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} />
            Obligatoire à la création
          </label>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={f.forRequester} onChange={(e) => setF({ ...f, forRequester: e.target.checked })} />
          Visible et saisissable par le demandeur
        </label>
      </div>
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

export function CustomFieldsAdmin() {
  const { data, error, isPending } = useQuery({ queryKey: KEY, queryFn: adminApi.customFields });
  const [editing, setEditing] = useState<CustomField | 'new' | null>(null);
  const reorder = useAdminMutation(adminApi.reorderCustomFields, [KEY, ['config']]);
  const toggle = useAdminMutation(({ id, isActive }: { id: string; isActive: boolean }) => adminApi.updateCustomField(id, { isActive }), [KEY, ['config']]);

  function move(index: number, delta: number) {
    const ids = (data ?? []).map((x) => x.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids);
  }

  return (
    <div className="admin-section">
      {editing && <FieldForm key={editing === 'new' ? 'new' : editing.id} field={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      <section className="card">
        <div className="section-header">
          <h2>Champs du ticket</h2>
          {!editing && (
            <button type="button" className="primary" onClick={() => setEditing('new')}>
              Nouveau champ
            </button>
          )}
        </div>
        <p className="muted small">
          Champs ajoutés au formulaire de création et à la fiche du ticket, après les champs de qualification. Un champ n’est jamais supprimé : on l’archive, et
          les valeurs déjà saisies sont conservées. Les modifications du support sont journalisées.
        </p>
        <ErrorMessage error={error ?? reorder.error ?? toggle.error} />
        {isPending ? (
          <Spinner />
        ) : data?.length === 0 ? (
          <p className="empty">Aucun champ personnalisé.</p>
        ) : (
          <ul className="mailboxes">
            {data?.map((field, i) => (
              <li key={field.id} className={field.isActive ? 'mailbox' : 'mailbox inactive'}>
                <div className="mailbox-head">
                  <span className="view-name">
                    <strong>{field.label}</strong>
                    <span className="muted small">
                      {CUSTOM_FIELD_KIND_LABELS[field.kind]} · {field.key}
                      {field.required && ' · obligatoire'}
                      {field.forRequester && ' · ouvert au demandeur'}
                    </span>
                  </span>
                  <span className="row-actions">
                    {!field.isActive && <span className="badge archived-badge">Archivé</span>}
                    <button type="button" className="link" aria-label={`Monter ${field.label}`} disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className="link" aria-label={`Descendre ${field.label}`} disabled={i === data.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                    <button type="button" className="link" onClick={() => setEditing(field)}>
                      Modifier
                    </button>
                    <button type="button" className="link" onClick={() => toggle.mutate({ id: field.id, isActive: !field.isActive })}>
                      {field.isActive ? 'Archiver' : 'Restaurer'}
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
