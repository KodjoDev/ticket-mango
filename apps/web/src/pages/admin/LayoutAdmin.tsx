import {
  DEFAULT_LIST_COLUMNS,
  DEFAULT_TICKET_PAGE,
  LOCKED_PAGE_BLOCKS,
  PAGE_BLOCK_LABELS,
  PAGE_COLUMN_LABELS,
  PAGE_COLUMNS,
  type PageBlock,
  type PageBlockItem,
  type PageColumn,
  DEFAULT_TICKET_FORM,
  LIST_COLUMN_LABELS,
  TICKET_FORM_FIELD_LABELS,
  type LayoutItem,
} from "@ticketing/shared";
import { useState } from "react";
import { CustomFieldsAdmin } from "./CustomFieldsAdmin";
import { adminApi } from "../../api/client";
import { ErrorMessage } from "../../components/ui";
import { useConfig } from "../../config/ConfigContext";
import { move, OrderButtons, useAdminMutation } from "./common";

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

function LayoutEditor<T extends string>({
  title,
  help,
  saved,
  defaults,
  labels,
  locked = [],
  onSave,
}: EditorProps<T>) {
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
          <li
            key={item.key}
            className={item.visible ? "option-row" : "option-row inactive"}
          >
            <OrderButtons
              index={i}
              count={items.length}
              label={labels[item.key]}
              onMove={(d) => setItems(move(items, i, d))}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={item.visible}
                disabled={locked.includes(item.key)}
                onChange={(e) =>
                  setItems(
                    items.map((x) =>
                      x.key === item.key
                        ? { ...x, visible: e.target.checked }
                        : x,
                    ),
                  )
                }
              />
              {labels[item.key]}
            </label>
            {locked.includes(item.key) && (
              <span className="muted small">toujours affiché</span>
            )}
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
        <button
          type="button"
          className="primary"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(items)}
        >
          Enregistrer
        </button>
      </div>
    </section>
  );
}

function TicketPageEditor() {
  const config = useConfig();
  const saved = config.ticketPage;
  const [items, setItems] = useState(saved);
  const save = useAdminMutation(adminApi.saveTicketPage);
  const dirty = JSON.stringify(items) !== JSON.stringify(saved);
  const set = (key: PageBlock, change: Partial<PageBlockItem>) =>
    setItems(items.map((x) => (x.key === key ? { ...x, ...change } : x)));

  return (
    <section className="card">
      <h2>Page du ticket</h2>
      <p className="muted small">
        Ordre, colonne et visibilité des blocs de la page d’un ticket. L’ordre
        est celui de la liste, dans chaque colonne. Valable pour toute l’équipe.
      </p>
      <ErrorMessage error={save.error} />
      <ul className="option-list">
        {items.map((item, i) => (
          <li
            key={item.key}
            className={item.visible ? "option-row" : "option-row inactive"}
          >
            <OrderButtons
              index={i}
              count={items.length}
              label={PAGE_BLOCK_LABELS[item.key]}
              onMove={(d) => setItems(move(items, i, d))}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={item.visible}
                disabled={LOCKED_PAGE_BLOCKS.includes(item.key)}
                onChange={(e) => set(item.key, { visible: e.target.checked })}
              />
              {PAGE_BLOCK_LABELS[item.key]}
            </label>
            <select
              aria-label={`Colonne de ${PAGE_BLOCK_LABELS[item.key]}`}
              value={item.column}
              onChange={(e) =>
                set(item.key, { column: e.target.value as PageColumn })
              }
            >
              {PAGE_COLUMNS.map((c) => (
                <option key={c} value={c}>
                  {PAGE_COLUMN_LABELS[c]}
                </option>
              ))}
            </select>
            {LOCKED_PAGE_BLOCKS.includes(item.key) && (
              <span className="muted small">toujours affiché</span>
            )}
          </li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" onClick={() => setItems(DEFAULT_TICKET_PAGE)}>
          Valeurs par défaut
        </button>
        <button type="button" disabled={!dirty} onClick={() => setItems(saved)}>
          Annuler
        </button>
        <button
          type="button"
          className="primary"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(items)}
        >
          Enregistrer
        </button>
      </div>
    </section>
  );
}

export function LayoutAdmin() {
  const config = useConfig();
  return (
    <>
      <div className="admin-section two-columns">
        <TicketPageEditor />
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
          locked={["subject"]}
          onSave={adminApi.saveListColumns}
        />
      </div>
      <div className="admin-section">
        <CustomFieldsAdmin />
      </div>
    </>
  );
}
