import {
  IMPACT_LABELS,
  IMPACTS,
  URGENCIES,
  URGENCY_LABELS,
  type Impact,
  type OptionField,
  type TicketFormField,
  type Urgency,
} from '@ticketing/shared';
import type { ReactNode } from 'react';
import { useConfig } from '../config/ConfigContext';
import { TagPicker } from './tags';
import { Field, options } from './ui';

export interface QualificationValues {
  type: string;
  component: string | null;
  environment: string | null;
  impact: Impact;
  urgency: Urgency;
  tagIds: string[];
}

interface Props {
  values: QualificationValues;
  onChange: (change: Partial<QualificationValues>) => void;
  disabled?: boolean;
  /** Impact, urgence et tags relèvent du support : masqués pour un utilisateur externe. */
  supportFields: boolean;
}

const SUPPORT_ONLY: TicketFormField[] = ['impact', 'urgency', 'tags'];

/** Champs de qualification, dans l'ordre et avec la visibilité définis par l'administrateur. */
export function QualificationFields({ values, onChange, disabled, supportFields }: Props) {
  const config = useConfig();

  const listSelect = (field: OptionField, key: 'type' | 'component' | 'environment', label: string, optional: boolean) => (
    <Field label={label}>
      <select
        value={values[key] ?? ''}
        disabled={disabled}
        onChange={(e) => onChange({ [key]: e.target.value || null })}
      >
        {optional && <option value="">Non précisé</option>}
        {config.choices(field, values[key]).map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
            {o.isActive ? '' : ' (archivé)'}
          </option>
        ))}
      </select>
    </Field>
  );

  const render: Record<TicketFormField, () => ReactNode> = {
    type: () => listSelect('TYPE', 'type', 'Type', false),
    component: () => listSelect('COMPONENT', 'component', 'Module', true),
    environment: () => listSelect('ENVIRONMENT', 'environment', 'Environnement', true),
    impact: () => (
      <Field label="Impact">
        <select value={values.impact} disabled={disabled} onChange={(e) => onChange({ impact: e.target.value as Impact })}>
          {options(IMPACTS, IMPACT_LABELS)}
        </select>
      </Field>
    ),
    urgency: () => (
      <Field label="Urgence">
        <select value={values.urgency} disabled={disabled} onChange={(e) => onChange({ urgency: e.target.value as Urgency })}>
          {options(URGENCIES, URGENCY_LABELS)}
        </select>
      </Field>
    ),
    tags: () => (
      <div className="field">
        <span className="field-label">Tags</span>
        <TagPicker
          choices={config.tagChoices(values.tagIds)}
          selected={values.tagIds}
          disabled={disabled}
          onChange={(tagIds) => onChange({ tagIds })}
        />
      </div>
    ),
  };

  return (
    <>
      {config.ticketForm
        .filter((f) => f.visible && (supportFields || !SUPPORT_ONLY.includes(f.key)))
        .map((f) => (
          <div key={f.key} className="qualification-field">
            {render[f.key]()}
          </div>
        ))}
    </>
  );
}
