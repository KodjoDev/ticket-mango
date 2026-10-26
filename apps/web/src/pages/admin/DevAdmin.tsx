import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_STATUS_MAPS,
  DEV_PROVIDER_LABELS,
  DEV_PROVIDERS,
  DEV_SYNC_STATUSES,
  STATUS_LABELS,
  type DevProviderName,
  type TicketStatus,
} from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { adminApi, type DevIntegrationInput } from '../../api/client';
import type { DevIntegration } from '../../api/types';
import { ErrorMessage, Field, Spinner } from '../../components/ui';
import { useAdminMutation } from './common';
import { copyText } from '../../clipboard/copy';

const KEY = ['admin', 'dev-integrations'];

const HELP: Record<DevProviderName, { project: string; token: string; status: string; webhook: string }> = {
  JIRA: {
    project: 'Clé du projet, ex. APP',
    token: 'Jeton d’API Atlassian (id.atlassian.com/manage-profile/security/api-tokens), associé à l’e-mail du compte.',
    status: 'Nom du statut Jira (« In Progress », « Done »…).',
    webhook: 'Jira → Paramètres système → Webhooks : collez l’URL ci-dessous, événements « Issue : créée / mise à jour ». Les versions de correction (fixVersions) sont reprises.',
  },
  GITHUB: {
    project: 'Dépôt « propriétaire/nom », ex. acme/app',
    token: 'Jeton d’accès (fine-grained) avec le droit « Issues : lecture et écriture » sur le dépôt.',
    status: 'Libellé d’une étiquette de l’issue (« in progress »…), ou état « open » / « closed ». Le jalon (milestone) sert de version de correction.',
    webhook: 'Dépôt → Settings → Webhooks : collez l’URL, type de contenu application/json, événement « Issues » seulement.',
  },
};

type Row = { external: string; status: TicketStatus };
const toRows = (map: Record<string, TicketStatus>): Row[] => Object.entries(map).map(([external, status]) => ({ external, status }));

function IntegrationForm({ integration, onDone }: { integration?: DevIntegration; onDone: () => void }) {
  const [f, setF] = useState({
    provider: (integration?.provider ?? 'JIRA') as DevProviderName,
    name: integration?.name ?? '',
    isActive: integration?.isActive ?? true,
    baseUrl: integration?.baseUrl ?? '',
    account: integration?.account ?? '',
    token: '',
    project: integration?.project ?? '',
    issueType: integration?.issueType ?? 'Bug',
  });
  const [rows, setRows] = useState<Row[]>(toRows(integration?.statusMap ?? DEFAULT_STATUS_MAPS[f.provider]));
  const set = (change: Partial<typeof f>) => setF({ ...f, ...change });
  const help = HELP[f.provider];
  const save = useAdminMutation(
    (input: Partial<DevIntegrationInput>) =>
      integration ? adminApi.updateDevIntegration(integration.id, input) : adminApi.createDevIntegration(input),
    [KEY],
  );

  function changeProvider(provider: DevProviderName) {
    setF({ ...f, provider });
    setRows(toRows(DEFAULT_STATUS_MAPS[provider]));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { provider, ...rest } = f;
    save.mutate(
      {
        ...rest,
        ...(!integration && { provider }),
        baseUrl: f.baseUrl.trim() || null,
        account: f.provider === 'JIRA' ? f.account.trim() || null : null,
        statusMap: Object.fromEntries(rows.filter((r) => r.external.trim()).map((r) => [r.external.trim().toLowerCase(), r.status])),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>{integration ? `Modifier ${integration.name}` : 'Nouvelle intégration'}</h2>
      <ErrorMessage error={save.error} />
      <div className="grid-3">
        <Field label="Outil">
          <select value={f.provider} disabled={!!integration} onChange={(e) => changeProvider(e.target.value as DevProviderName)}>
            {DEV_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {DEV_PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nom">
          <input required value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Jira produit" />
        </Field>
        <label className="checkbox macro-assign">
          <input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          Active
        </label>
      </div>
      <div className="grid-3">
        <Field label={f.provider === 'JIRA' ? 'Projet (clé)' : 'Dépôt'}>
          <input required value={f.project} onChange={(e) => set({ project: e.target.value })} placeholder={help.project} />
        </Field>
        {f.provider === 'JIRA' ? (
          <>
            <Field label="Site Jira">
              <input required type="url" value={f.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://acme.atlassian.net" />
            </Field>
            <Field label="E-mail du compte">
              <input required type="email" value={f.account} onChange={(e) => set({ account: e.target.value })} />
            </Field>
          </>
        ) : (
          <Field label="API GitHub Enterprise (facultatif)">
            <input type="url" value={f.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://api.github.com" />
          </Field>
        )}
      </div>
      <div className="grid-3">
        <Field label={integration?.hasToken ? 'Jeton d’API (laisser vide pour le conserver)' : 'Jeton d’API'}>
          <input type="password" autoComplete="new-password" value={f.token} onChange={(e) => set({ token: e.target.value })} />
        </Field>
        {f.provider === 'JIRA' && (
          <Field label="Type d’issue créé">
            <input required value={f.issueType} onChange={(e) => set({ issueType: e.target.value })} />
          </Field>
        )}
      </div>
      <p className="muted small">{help.token}</p>

      <h3 className="subhead">Correspondance des statuts (outil → ticket)</h3>
      <p className="muted small">{help.status} Un statut absent de la table ne modifie pas le ticket ; un ticket résolu ou clôturé n’est jamais modifié.</p>
      <ul className="status-map">
        {rows.map((row, i) => (
          <li key={i} className="inline-form">
            <input
              aria-label="Statut de l’outil"
              value={row.external}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, external: e.target.value } : r)))}
            />
            <span aria-hidden="true">→</span>
            <select
              aria-label="Statut du ticket"
              value={row.status}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, status: e.target.value as TicketStatus } : r)))}
            >
              {DEV_SYNC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <button type="button" className="link danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              Retirer
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="link" onClick={() => setRows([...rows, { external: '', status: 'IN_PROGRESS' }])}>
        Ajouter une correspondance
      </button>
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

function IntegrationRow({ integration, onEdit }: { integration: DevIntegration; onEdit: () => void }) {
  const remove = useAdminMutation(() => adminApi.deleteDevIntegration(integration.id), [KEY]);
  return (
    <li className={integration.isActive ? 'mailbox' : 'mailbox inactive'}>
      <div className="mailbox-head">
        <span className="view-name">
          <strong>
            {integration.name} · {DEV_PROVIDER_LABELS[integration.provider]} {integration.project}
          </strong>
          <span className="muted small">{integration.hasToken ? 'Jeton enregistré' : 'Aucun jeton : les appels sortants échoueront'}</span>
        </span>
        <span className="row-actions">
          {!integration.isActive && <span className="badge archived-badge">Inactive</span>}
          <button type="button" className="link" onClick={onEdit}>
            Modifier
          </button>
          <button
            type="button"
            className="link danger"
            onClick={() =>
              window.confirm(`Supprimer ${integration.name} ? Les liens vers ses issues seront supprimés des tickets.`) && remove.mutate(undefined)
            }
          >
            Supprimer
          </button>
        </span>
      </div>
      <ErrorMessage error={remove.error} />
      <div className="webhook">
        <span className="field-label">URL du webhook entrant</span>
        <code>{integration.webhookUrl}</code>
        <button type="button" className="link" onClick={() => void copyText(integration.webhookUrl)}>
          Copier
        </button>
      </div>
      <p className="muted small">{HELP[integration.provider].webhook}</p>
    </li>
  );
}

export function DevAdmin() {
  const { data, error, isPending } = useQuery({ queryKey: KEY, queryFn: adminApi.devIntegrations });
  const [editing, setEditing] = useState<DevIntegration | 'new' | null>(null);
  return (
    <div className="admin-section">
      {editing && (
        <IntegrationForm key={editing === 'new' ? 'new' : editing.id} integration={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
      )}
      <section className="card">
        <div className="section-header">
          <h2>Outils de développement</h2>
          {!editing && (
            <button type="button" className="primary" onClick={() => setEditing('new')}>
              Nouvelle intégration
            </button>
          )}
        </div>
        <p className="muted small">
          Depuis un ticket, le support crée ou lie une issue Jira / GitHub. Quand l’équipe de développement fait avancer l’issue, le statut du
          ticket et sa version de correction se mettent à jour via le webhook.
        </p>
        <ErrorMessage error={error} />
        {isPending ? (
          <Spinner />
        ) : data?.length === 0 ? (
          <p className="empty">Aucune intégration configurée.</p>
        ) : (
          <ul className="mailboxes">
            {data?.map((i) => (
              <IntegrationRow key={i.id} integration={i} onEdit={() => setEditing(i)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
