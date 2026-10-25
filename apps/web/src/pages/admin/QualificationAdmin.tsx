import { OPTION_FIELD_LABELS, OPTION_FIELDS, type OptionField } from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { adminApi } from '../../api/client';
import type { FieldOption } from '../../api/types';
import { ErrorMessage, Field } from '../../components/ui';
import { useConfig } from '../../config/ConfigContext';
import { keyFromLabel, move, OrderButtons, useAdminMutation } from './common';

function AddOptionForm({ field }: { field: OptionField }) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const create = useAdminMutation(adminApi.createOption);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { field, key, label },
      {
        onSuccess: () => {
          setLabel('');
          setKey('');
          setKeyEdited(false);
        },
      },
    );
  }

  return (
    <form className="add-row" onSubmit={onSubmit}>
      <ErrorMessage error={create.error} />
      <Field label="Libellé">
        <input
          required
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            if (!keyEdited) setKey(keyFromLabel(e.target.value));
          }}
        />
      </Field>
      <Field label="Code (non modifiable ensuite)">
        <input
          required
          pattern="[A-Z][A-Z0-9_]{0,39}"
          title="Majuscules, chiffres et _ ; commence par une lettre"
          value={key}
          onChange={(e) => {
            setKey(e.target.value.toUpperCase());
            setKeyEdited(true);
          }}
        />
      </Field>
      <button type="submit" className="primary" disabled={create.isPending}>
        Ajouter
      </button>
    </form>
  );
}

function OptionRow({ option, index, count, onMove, reordering }: {
  option: FieldOption;
  index: number;
  count: number;
  onMove: (delta: number) => void;
  reordering: boolean;
}) {
  const [label, setLabel] = useState(option.label);
  const update = useAdminMutation((input: { label?: string; isActive?: boolean }) => adminApi.updateOption(option.id, input));
  const remove = useAdminMutation(() => adminApi.deleteOption(option.id));

  return (
    <li className={option.isActive ? 'option-row' : 'option-row inactive'}>
      <OrderButtons index={index} count={count} onMove={onMove} disabled={reordering} label={option.label} />
      <input
        aria-label={`Libellé de ${option.key}`}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label.trim() && label !== option.label && update.mutate({ label: label.trim() })}
      />
      <code className="muted">{option.key}</code>
      <span className="badges">
        {option.isSystem && <span className="badge system-badge" title="Utilisé par le fonctionnement de l'application">Système</span>}
        {!option.isActive && <span className="badge archived-badge">Archivé</span>}
      </span>
      <span className="row-actions">
        {!option.isSystem && (
          <button type="button" className="link" disabled={update.isPending} onClick={() => update.mutate({ isActive: !option.isActive })}>
            {option.isActive ? 'Archiver' : 'Réactiver'}
          </button>
        )}
        {!option.isSystem && (
          <button
            type="button"
            className="link danger"
            disabled={remove.isPending}
            onClick={() => window.confirm(`Supprimer « ${option.label} » ?`) && remove.mutate(undefined)}
          >
            Supprimer
          </button>
        )}
      </span>
      {(update.error || remove.error) && (
        <div className="row-error">
          <ErrorMessage error={update.error ?? remove.error} />
        </div>
      )}
    </li>
  );
}

export function QualificationAdmin() {
  const config = useConfig();
  const [field, setField] = useState<OptionField>('TYPE');
  const reorder = useAdminMutation((ids: string[]) => adminApi.reorderOptions(field, ids));
  const items = config.options.filter((o) => o.field === field);

  return (
    <div className="admin-section">
      <div className="segmented" role="tablist" aria-label="Liste">
        {OPTION_FIELDS.map((f) => (
          <button key={f} type="button" role="tab" aria-selected={f === field} onClick={() => setField(f)}>
            {OPTION_FIELD_LABELS[f]}
          </button>
        ))}
      </div>
      <section className="card">
        <h2>{OPTION_FIELD_LABELS[field]}</h2>
        <p className="muted small">
          Une valeur déjà utilisée par des tickets ne peut pas être supprimée : archivez-la pour ne plus la proposer. Les
          tickets existants la conservent.
        </p>
        <ErrorMessage error={reorder.error} />
        <ul className="option-list">
          {items.map((o, i) => (
            <OptionRow
              key={o.id}
              option={o}
              index={i}
              count={items.length}
              reordering={reorder.isPending}
              onMove={(delta) => reorder.mutate(move(items, i, delta).map((x) => x.id))}
            />
          ))}
        </ul>
        <AddOptionForm key={field} field={field} />
      </section>
    </div>
  );
}
