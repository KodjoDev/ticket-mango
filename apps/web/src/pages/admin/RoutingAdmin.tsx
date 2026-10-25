import { useQuery } from '@tanstack/react-query';
import { PRIORITIES, type OptionField, type Priority } from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { adminApi } from '../../api/client';
import type { RoutingRule, RuleConditions } from '../../api/types';
import { ErrorMessage, Field, Spinner } from '../../components/ui';
import { useConfig, type ConfigHelpers } from '../../config/ConfigContext';
import { move, OrderButtons, useAdminMutation } from './common';

const RULES_KEY = ['admin', 'routing-rules'];

export function describeConditions(c: RuleConditions, config: ConfigHelpers): string {
  const part = (field: OptionField, keys?: string[]) => keys?.map((k) => config.label(field, k)).join(' ou ');
  const parts = [
    c.type?.length && `type ${part('TYPE', c.type)}`,
    c.component?.length && `module ${part('COMPONENT', c.component)}`,
    c.environment?.length && `environnement ${part('ENVIRONMENT', c.environment)}`,
    c.priority?.length && `priorité ${c.priority.join('/')}`,
  ].filter(Boolean);
  return parts.length ? `Si ${parts.join(' et ')}` : 'Tous les tickets (règle par défaut)';
}

function MultiChoice<T extends string>({
  legend,
  values,
  selected,
  onChange,
}: {
  legend: string;
  values: { key: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <fieldset className="checks">
      <legend className="field-label">{legend}</legend>
      {values.map((v) => (
        <label key={v.key} className="checkbox">
          <input
            type="checkbox"
            checked={selected.includes(v.key)}
            onChange={(e) => onChange(e.target.checked ? [...selected, v.key] : selected.filter((x) => x !== v.key))}
          />
          {v.label}
        </label>
      ))}
    </fieldset>
  );
}

function RuleForm({ rule, onDone }: { rule?: RoutingRule; onDone: () => void }) {
  const config = useConfig();
  const [name, setName] = useState(rule?.name ?? '');
  const [groupId, setGroupId] = useState(rule?.groupId ?? config.groups[0]?.id ?? '');
  const [c, setC] = useState<RuleConditions>(rule?.conditions ?? {});
  const save = useAdminMutation(
    (input: { name: string; conditions: RuleConditions; groupId: string }) => (rule ? adminApi.updateRule(rule.id, input) : adminApi.createRule(input)),
    [RULES_KEY],
  );
  const opts = (field: OptionField, current: string[] = []) =>
    config.options.filter((o) => o.field === field && (o.isActive || current.includes(o.key))).map((o) => ({ key: o.key, label: o.label }));
  // Une liste vide signifie « toutes les valeurs » : on ne l'envoie pas.
  const clean = (obj: RuleConditions) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v?.length)) as RuleConditions;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ name: name.trim(), conditions: clean(c), groupId }, { onSuccess: onDone });
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>{rule ? `Modifier « ${rule.name} »` : 'Nouvelle règle'}</h2>
      <ErrorMessage error={save.error} />
      <div className="grid-3">
        <Field label="Nom">
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Router vers le groupe">
          <select required value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {config.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.isActive ? '' : ' (inactif)'}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="muted small">Conditions cumulatives ; ne rien cocher dans une catégorie signifie « peu importe ».</p>
      <MultiChoice legend="Type" values={opts('TYPE', c.type)} selected={c.type ?? []} onChange={(type) => setC({ ...c, type })} />
      <MultiChoice legend="Module" values={opts('COMPONENT', c.component)} selected={c.component ?? []} onChange={(component) => setC({ ...c, component })} />
      <MultiChoice
        legend="Environnement"
        values={opts('ENVIRONMENT', c.environment)}
        selected={c.environment ?? []}
        onChange={(environment) => setC({ ...c, environment })}
      />
      <MultiChoice<Priority>
        legend="Priorité"
        values={PRIORITIES.map((p) => ({ key: p, label: p }))}
        selected={c.priority ?? []}
        onChange={(priority) => setC({ ...c, priority })}
      />
      <div className="actions">
        <button type="button" onClick={onDone}>
          Annuler
        </button>
        <button type="submit" className="primary" disabled={save.isPending || !groupId}>
          Enregistrer
        </button>
      </div>
    </form>
  );
}

export function RoutingAdmin() {
  const config = useConfig();
  const { data: rules, error, isPending } = useQuery({ queryKey: RULES_KEY, queryFn: adminApi.routingRules });
  const [editing, setEditing] = useState<RoutingRule | 'new' | null>(null);
  const reorder = useAdminMutation(adminApi.reorderRules, [RULES_KEY]);
  const toggle = useAdminMutation(({ id, isActive }: { id: string; isActive: boolean }) => adminApi.updateRule(id, { isActive }), [RULES_KEY]);
  const remove = useAdminMutation(adminApi.deleteRule, [RULES_KEY]);
  const hasFallback = (rules ?? []).some((r) => r.isActive && Object.keys(r.conditions).length === 0);

  return (
    <div className="admin-section">
      {editing && <RuleForm key={editing === 'new' ? 'new' : editing.id} rule={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      <section className="card">
        <div className="section-header">
          <h2>Règles de routage</h2>
          {!editing && (
            <button type="button" className="primary" onClick={() => setEditing('new')}>
              Nouvelle règle
            </button>
          )}
        </div>
        <p className="muted small">
          Évaluées dans l'ordre à la création d'un ticket : la première qui correspond désigne le groupe, puis le mode de
          distribution du groupe choisit l'agent.
        </p>
        {rules && !hasFallback && (
          <div className="alert">Aucune règle par défaut active : les tickets qui ne correspondent à rien n'auront pas de groupe.</div>
        )}
        <ErrorMessage error={error ?? reorder.error ?? toggle.error ?? remove.error} />
        {isPending ? (
          <Spinner />
        ) : (
          <ul className="option-list">
            {(rules ?? []).map((r, i, all) => (
              <li key={r.id} className={r.isActive ? 'option-row' : 'option-row inactive'}>
                <OrderButtons index={i} count={all.length} label={r.name} disabled={reorder.isPending} onMove={(d) => reorder.mutate(move(all, i, d).map((x) => x.id))} />
                <span className="view-name">
                  <strong>
                    {i + 1}. {r.name} → {r.group.name}
                  </strong>
                  <span className="muted small">{describeConditions(r.conditions, config)}</span>
                </span>
                <span className="row-actions">
                  <button type="button" className="link" onClick={() => setEditing(r)}>
                    Modifier
                  </button>
                  <button type="button" className="link" onClick={() => toggle.mutate({ id: r.id, isActive: !r.isActive })}>
                    {r.isActive ? 'Désactiver' : 'Activer'}
                  </button>
                  <button
                    type="button"
                    className="link danger"
                    onClick={() => window.confirm(`Supprimer la règle « ${r.name} » ?`) && remove.mutate(r.id)}
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
