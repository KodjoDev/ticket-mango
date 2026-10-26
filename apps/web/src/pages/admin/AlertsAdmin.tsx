import { useQuery } from '@tanstack/react-query';
import { ALERT_KIND_LABELS, ALERT_KINDS, ALERT_TARGET_IS_KEY, type AlertKindName } from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { adminApi } from '../../api/client';
import type { AlertChannel } from '../../api/types';
import { ErrorMessage, Field, Spinner } from '../../components/ui';
import { useAdminMutation } from './common';

const KEY = ['admin', 'alert-channels'];

const TARGET_HELP: Record<AlertKindName, string> = {
  SLACK: 'URL du webhook entrant Slack (Apps → Incoming Webhooks).',
  TEAMS: 'URL du webhook du flux Teams (Workflows → « Quand une requête webhook est reçue »).',
  PAGERDUTY: 'Clé d’intégration (Integration Key) d’un service PagerDuty utilisant l’API Events v2. L’ouverture déclenche l’astreinte, la résolution la clôt.',
  WEBHOOK: 'URL https qui reçoit un POST JSON { event, incident }. Pour une passerelle SMS, pointez vers votre fournisseur.',
};

function ChannelForm({ channel, onDone }: { channel?: AlertChannel; onDone: () => void }) {
  const [f, setF] = useState({ kind: (channel?.kind ?? 'SLACK') as AlertKindName, name: channel?.name ?? '', target: '', isActive: channel?.isActive ?? true });
  const save = useAdminMutation(
    () =>
      channel
        ? adminApi.updateAlertChannel(channel.id, { name: f.name, isActive: f.isActive, ...(f.target && { target: f.target }) })
        : adminApi.createAlertChannel(f),
    [KEY],
  );
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined, { onSuccess: onDone });
  };
  const isKey = ALERT_TARGET_IS_KEY[f.kind];
  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>{channel ? `Modifier ${channel.name}` : 'Nouvelle destination'}</h2>
      <ErrorMessage error={save.error} />
      <div className="grid-3">
        <Field label="Outil">
          <select value={f.kind} disabled={!!channel} onChange={(e) => setF({ ...f, kind: e.target.value as AlertKindName })}>
            {ALERT_KINDS.map((k) => (
              <option key={k} value={k}>
                {ALERT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nom">
          <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Astreinte" />
        </Field>
        <label className="checkbox macro-assign">
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          Active
        </label>
      </div>
      <Field label={channel ? `${isKey ? 'Clé' : 'URL'} (laisser vide pour la conserver)` : isKey ? 'Clé d’intégration' : 'URL du webhook'}>
        <input
          required={!channel}
          type={isKey ? 'password' : 'url'}
          autoComplete="off"
          value={f.target}
          onChange={(e) => setF({ ...f, target: e.target.value })}
        />
      </Field>
      <p className="muted small">{TARGET_HELP[f.kind]}</p>
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

function ChannelRow({ channel, onEdit }: { channel: AlertChannel; onEdit: () => void }) {
  const remove = useAdminMutation(() => adminApi.deleteAlertChannel(channel.id), [KEY]);
  return (
    <li className={channel.isActive ? 'mailbox' : 'mailbox inactive'}>
      <div className="mailbox-head">
        <span className="view-name">
          <strong>
            {channel.name} · {ALERT_KIND_LABELS[channel.kind]}
          </strong>
          <span className="muted small">Destination enregistrée (masquée)</span>
        </span>
        <span className="row-actions">
          {!channel.isActive && <span className="badge archived-badge">Inactive</span>}
          <button type="button" className="link" onClick={onEdit}>
            Modifier
          </button>
          <button type="button" className="link danger" onClick={() => window.confirm(`Supprimer ${channel.name} ?`) && remove.mutate(undefined)}>
            Supprimer
          </button>
        </span>
      </div>
      <ErrorMessage error={remove.error} />
    </li>
  );
}

export function AlertsAdmin() {
  const { data, error, isPending } = useQuery({ queryKey: KEY, queryFn: adminApi.alertChannels });
  const [editing, setEditing] = useState<AlertChannel | 'new' | null>(null);
  return (
    <div className="admin-section">
      {editing && <ChannelForm key={editing === 'new' ? 'new' : editing.id} channel={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      <section className="card">
        <div className="section-header">
          <h2>Alertes d’astreinte</h2>
          {!editing && (
            <button type="button" className="primary" onClick={() => setEditing('new')}>
              Nouvelle destination
            </button>
          )}
        </div>
        <p className="muted small">
          À l’ouverture, à chaque mise à jour et à la résolution d’un incident majeur, ces destinations sont alertées. Le résultat de chaque envoi est
          visible sur la fiche de l’incident. Aucun SMS n’est envoyé directement : passez par PagerDuty ou une passerelle SMS en webhook.
        </p>
        <ErrorMessage error={error} />
        {isPending ? (
          <Spinner />
        ) : data?.length === 0 ? (
          <p className="empty">Aucune destination : seules les notifications internes sont envoyées.</p>
        ) : (
          <ul className="mailboxes">
            {data?.map((c) => (
              <ChannelRow key={c.id} channel={c} onEdit={() => setEditing(c)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
