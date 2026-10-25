import {
  DEFAULT_LIST_COLUMNS,
  DEFAULT_TICKET_FORM,
  LIST_COLUMN_LABELS,
  TICKET_FORM_FIELD_LABELS,
  type LayoutItem,
} from '@ticketing/shared';
import { useState } from 'react';
import { adminApi } from '../../api/client';
import { ErrorMessage } from '../../components/ui';
import { useConfig } from '../../config/ConfigContext';
import { move, OrderButtons, useAdminMutation } from './common';

interface EditorProps<T extends string> {
  title: string;
  help: string;
  saved: LayoutItem<T>[];
  defaults: LayoutItem<T>[];
  labels: Record<T, string>;
  /** Éléments qui doivent rester visibles. */
  locked?: T[];
  onSave: (layout: LayoutItem<T>[]) => Promise<unknown>;
}

function LayoutEditor<T extends string>({ title, help, saved, defaults, labels, locked = [], onSave }: EditorProps<T>) {
  const [items, setItems] = useState(saved);
  const save = useAdminMutation(onSave);
  const dirty = JSON.stringify(items) !== JSON.stringify(saved);

  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="muted small">{help}</p>
      <ErrorMessage error={save.error} />
      <ul className="option-list">
        {items.map((item, i) => (
          <li key={item.key} className={item.visible ? 'option-row' : 'option-row inactive'}>
            <OrderButtons index={i} count={items.length} label={labels[item.key]} onMove={(d) => setItems(move(items, i, d))} />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={item.visible}
                disabled={locked.includes(item.key)}
                onChange={(e) => setItems(items.map((x) => (x.key === item.key ? { ...x, visible: e.target.checked } : x)))}
              />
              {labels[item.key]}
            </label>
            {locked.includes(item.key) && <span className="muted small">toujours affiché</span>}
          </li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" onClick={() => setItems(defaults)}>
          Valeurs par défaut
        </button>
        <button type="button" disabled={!dirty} onClick={() => setItems(saved)}>
          Annuler
        </button>
        <button type="button" className="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(items)}>
          Enregistrer
        </button>
      </div>
    </section>
  );
}

export function LayoutAdmin() {
  const config = useConfig();
  return (
    <div className="admin-section two-columns">
      <LayoutEditor
        title="Champs du ticket"
        help="Ordre et visibilité des champs de qualification, dans le panneau du ticket et le formulaire de création."
        saved={config.ticketForm}
        defaults={DEFAULT_TICKET_FORM}
        labels={TICKET_FORM_FIELD_LABELS}
        onSave={adminApi.saveTicketForm}
      />
      <LayoutEditor
        title="Colonnes de la liste"
        help="Ordre et visibilité des colonnes de la liste des tickets."
        saved={config.listColumns}
        defaults={DEFAULT_LIST_COLUMNS}
        labels={LIST_COLUMN_LABELS}
        locked={['subject']}
        onSave={adminApi.saveListColumns}
      />
    </div>
  );
}
