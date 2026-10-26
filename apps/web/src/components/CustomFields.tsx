import type { CustomValue, CustomValues } from '@ticketing/shared';
import { useState } from 'react';
import type { CustomField } from '../api/types';

interface InputProps {
  field: CustomField;
  value: CustomValue | undefined;
  disabled?: boolean;
  /** Appelé à chaque saisie (création) ou à la fin de la saisie (édition d'un ticket existant). */
  onCommit: (value: CustomValue) => void;
  live: boolean;
}

function CustomFieldInput({ field, value, disabled, onCommit, live }: InputProps) {
  const [draft, setDraft] = useState<string>(value === null || value === undefined ? '' : String(value));
  const id = `cf-${field.key}`;
  const commitText = (text: string) => onCommit(text.trim() === '' ? null : text);
  const commitNumber = (text: string) => onCommit(text.trim() === '' || Number.isNaN(Number(text)) ? null : Number(text));
  // En édition, on n'enregistre que si la valeur a réellement changé.
  const onBlur = (commit: (text: string) => void) => () => {
    if (!live && draft !== (value === null || value === undefined ? '' : String(value))) commit(draft);
  };
  const change = (text: string, commit: (text: string) => void) => {
    setDraft(text);
    if (live) commit(text);
  };

  switch (field.kind) {
    case 'CHECKBOX':
      return (
        <label className="checkbox" htmlFor={id}>
          <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onCommit(e.target.checked)} />
          {field.label}
        </label>
      );
    case 'SELECT': {
      // La valeur actuelle reste affichée même si le choix a été retiré de la liste.
      const choices = typeof value === 'string' && !field.options.includes(value) ? [...field.options, value] : field.options;
      return (
        <select id={id} aria-label={field.label} value={typeof value === 'string' ? value : ''} disabled={disabled} required={field.required} onChange={(e) => onCommit(e.target.value || null)}>
          <option value="">Non précisé</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      );
    }
    case 'LONGTEXT':
      return (
        <textarea id={id} aria-label={field.label} rows={3} maxLength={5000} required={field.required} disabled={disabled} value={draft} onChange={(e) => change(e.target.value, commitText)} onBlur={onBlur(commitText)} />
      );
    case 'NUMBER':
      return (
        <input id={id} aria-label={field.label} type="number" step="any" required={field.required} disabled={disabled} value={draft} onChange={(e) => change(e.target.value, commitNumber)} onBlur={onBlur(commitNumber)} />
      );
    case 'DATE':
      return (
        <input id={id} aria-label={field.label} type="date" required={field.required} disabled={disabled} value={draft} onChange={(e) => change(e.target.value, commitText)} onBlur={onBlur(commitText)} />
      );
    case 'TEXT':
      return (
        <input id={id} aria-label={field.label} maxLength={500} required={field.required} disabled={disabled} value={draft} onChange={(e) => change(e.target.value, commitText)} onBlur={onBlur(commitText)} />
      );
  }
}

interface Props {
  fields: CustomField[];
  values: CustomValues;
  disabled?: boolean;
  /** `live` : chaque saisie remonte (formulaire de création). Sinon, à la fin de la saisie. */
  live: boolean;
  onChange: (key: string, value: CustomValue) => void;
}

/** Champs personnalisés définis par l'administrateur, dans leur ordre. */
export function CustomFieldInputs({ fields, values, disabled, live, onChange }: Props) {
  return (
    <>
      {fields.map((field) => (
        <div key={field.key} className="qualification-field">
          {field.kind === 'CHECKBOX' ? (
            <CustomFieldInput field={field} value={values[field.key]} disabled={disabled} live={live} onCommit={(v) => onChange(field.key, v)} />
          ) : (
            <label className="field">
              <span className="field-label">
                {field.label}
                {field.required && <span aria-hidden="true"> *</span>}
              </span>
              <CustomFieldInput field={field} value={values[field.key]} disabled={disabled} live={live} onCommit={(v) => onChange(field.key, v)} />
            </label>
          )}
        </div>
      ))}
    </>
  );
}

