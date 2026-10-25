import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { adminApi, type MailboxInput } from '../../api/client';
import type { EmailSettings, InboundStatus, Mailbox } from '../../api/types';
import { ErrorMessage, Field, formatDate, Spinner } from '../../components/ui';
import { useConfig } from '../../config/ConfigContext';
import { useAdminMutation } from './common';

const MAILBOXES_KEY = ['admin', 'mailboxes'];

/** Paramètres IMAP des messageries courantes, pour éviter les erreurs de saisie. */
const IMAP_PRESETS = {
  gmail: { label: 'Gmail / Google Workspace', host: 'imap.gmail.com', port: 993, help: 'Identifiant : l’adresse complète. Mot de passe : un mot de passe d’application (myaccount.google.com/apppasswords), IMAP activé dans les paramètres Gmail.' },
  ovh: { label: 'OVHcloud (Zimbra / MX Plan)', host: 'ssl0.ovh.net', port: 993, help: 'Identifiant : l’adresse complète.' },
  ionos: { label: 'IONOS', host: 'imap.ionos.fr', port: 993, help: 'Identifiant : l’adresse complète.' },
  outlook: { label: 'Microsoft 365 / Outlook', host: 'outlook.office365.com', port: 993, help: 'Attention : Microsoft a désactivé la connexion IMAP par mot de passe ; utilisez plutôt le webhook (transfert vers un service d’e-mail entrant).' },
} as const;

const INBOUND_LABELS: Record<InboundStatus, string> = {
  PROCESSED: 'Traité',
  DUPLICATE: 'Doublon',
  AUTO_REPLY: 'Réponse automatique',
  SPAM: 'Spam / bloqué',
  LOOP: 'Boucle',
  ERROR: 'Erreur',
};

function MailboxForm({ mailbox, onDone }: { mailbox?: Mailbox; onDone: () => void }) {
  const config = useConfig();
  const [f, setF] = useState<MailboxInput>({
    name: mailbox?.name ?? '',
    address: mailbox?.address ?? '',
    isActive: mailbox?.isActive ?? true,
    imapHost: mailbox?.imapHost ?? '',
    imapPort: mailbox?.imapPort ?? null,
    imapSecure: mailbox?.imapSecure ?? true,
    imapUser: mailbox?.imapUser ?? '',
    imapPassword: '',
    imapFolder: mailbox?.imapFolder ?? 'INBOX',
    defaultType: mailbox?.defaultType ?? null,
    defaultGroupId: mailbox?.defaultGroupId ?? null,
  });
  const set = (change: Partial<MailboxInput>) => setF({ ...f, ...change });
  const [preset, setPreset] = useState<keyof typeof IMAP_PRESETS | ''>('');
  const save = useAdminMutation(
    (input: MailboxInput) => (mailbox ? adminApi.updateMailbox(mailbox.id, input) : adminApi.createMailbox(input)),
    [MAILBOXES_KEY],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ ...f, imapHost: f.imapHost || null, imapUser: f.imapUser || null }, { onSuccess: onDone });
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>{mailbox ? `Modifier ${mailbox.address}` : 'Nouvelle boîte de réception'}</h2>
      <ErrorMessage error={save.error} />
      <div className="grid-3">
        <Field label="Nom">
          <input required value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Support" />
        </Field>
        <Field label="Adresse">
          <input required type="email" value={f.address} onChange={(e) => set({ address: e.target.value })} placeholder="support@exemple.fr" />
        </Field>
        <label className="checkbox macro-assign">
          <input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          Active
        </label>
      </div>
      <h3 className="subhead">Relève IMAP (facultatif si vous utilisez le webhook)</h3>
      <Field label="Préréglage">
        <select
          value=""
          onChange={(e) => {
            const p = IMAP_PRESETS[e.target.value as keyof typeof IMAP_PRESETS];
            if (p) set({ imapHost: p.host, imapPort: p.port, imapSecure: true, imapUser: f.imapUser || f.address });
            setPreset(e.target.value as keyof typeof IMAP_PRESETS);
          }}
        >
          <option value="">Choisir un fournisseur pour préremplir…</option>
          {Object.entries(IMAP_PRESETS).map(([k, p]) => (
            <option key={k} value={k}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      {preset && <p className="muted small">{IMAP_PRESETS[preset].help}</p>}
      {f.imapHost?.includes('@') && (
        <div className="alert">Le serveur IMAP est un nom de machine (ex. imap.gmail.com). L’adresse e-mail va dans « Identifiant ».</div>
      )}
      <div className="grid-4">
        <Field label="Serveur IMAP">
          <input value={f.imapHost ?? ''} onChange={(e) => set({ imapHost: e.target.value })} placeholder="imap.exemple.fr" />
        </Field>
        <Field label="Port">
          <input
            type="number"
            value={f.imapPort ?? ''}
            placeholder={f.imapSecure ? '993' : '143'}
            onChange={(e) => set({ imapPort: e.target.value ? Number(e.target.value) : null })}
          />
        </Field>
        <Field label="Identifiant">
          <input value={f.imapUser ?? ''} autoComplete="off" placeholder="adresse complète" onChange={(e) => set({ imapUser: e.target.value })} />
        </Field>
        <Field label={mailbox?.hasPassword ? 'Mot de passe (laisser vide pour le conserver)' : 'Mot de passe'}>
          <input type="password" autoComplete="new-password" value={f.imapPassword} onChange={(e) => set({ imapPassword: e.target.value })} />
        </Field>
      </div>
      <div className="grid-3">
        <Field label="Dossier">
          <input value={f.imapFolder} onChange={(e) => set({ imapFolder: e.target.value })} />
        </Field>
        <label className="checkbox macro-assign">
          <input type="checkbox" checked={f.imapSecure} onChange={(e) => set({ imapSecure: e.target.checked })} />
          Connexion chiffrée (TLS)
        </label>
      </div>
      <h3 className="subhead">Tickets créés par cette boîte</h3>
      <div className="grid-3">
        <Field label="Type par défaut">
          <select value={f.defaultType ?? ''} onChange={(e) => set({ defaultType: e.target.value || null })}>
            <option value="">Type par défaut de l'application</option>
            {config.choices('TYPE', f.defaultType).map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Groupe">
          <select value={f.defaultGroupId ?? ''} onChange={(e) => set({ defaultGroupId: e.target.value || null })}>
            <option value="">Selon les règles de routage</option>
            {config.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
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

function MailboxRow({ mailbox, onEdit }: { mailbox: Mailbox; onEdit: () => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const test = useAdminMutation(() => adminApi.testMailbox(mailbox.id), [MAILBOXES_KEY]);
  const poll = useAdminMutation(() => adminApi.pollMailbox(mailbox.id), [MAILBOXES_KEY, ['admin', 'inbound']]);
  const regenerate = useAdminMutation(() => adminApi.regenerateMailboxToken(mailbox.id), [MAILBOXES_KEY]);
  const remove = useAdminMutation(() => adminApi.deleteMailbox(mailbox.id), [MAILBOXES_KEY]);
  const hasImap = !!mailbox.imapHost;

  return (
    <li className={mailbox.isActive ? 'mailbox' : 'mailbox inactive'}>
      <div className="mailbox-head">
        <span className="view-name">
          <strong>
            {mailbox.name} · {mailbox.address}
          </strong>
          <span className="muted small">
            {hasImap ? `IMAP ${mailbox.imapHost} (${mailbox.imapFolder})` : 'Webhook uniquement'}
            {mailbox.lastCheckedAt && ` · dernière relève ${formatDate(mailbox.lastCheckedAt)}`}
          </span>
        </span>
        <span className="row-actions">
          {!mailbox.isActive && <span className="badge archived-badge">Inactive</span>}
          <button type="button" className="link" onClick={onEdit}>
            Modifier
          </button>
          {hasImap && (
            <>
              <button
                type="button"
                className="link"
                disabled={test.isPending}
                onClick={() =>
                  test.mutate(undefined, { onSuccess: (r) => setStatus(r.ok ? 'Connexion IMAP réussie.' : `Échec : ${r.error}`) })
                }
              >
                Tester
              </button>
              <button
                type="button"
                className="link"
                disabled={poll.isPending}
                onClick={() => poll.mutate(undefined, { onSuccess: (r) => setStatus(`${r.processed} message(s) relevé(s).`) })}
              >
                Relever maintenant
              </button>
            </>
          )}
          <button
            type="button"
            className="link danger"
            onClick={() => window.confirm(`Supprimer la boîte ${mailbox.address} ?`) && remove.mutate(undefined)}
          >
            Supprimer
          </button>
        </span>
      </div>
      {mailbox.lastError && <div className="alert">Dernière erreur : {mailbox.lastError}</div>}
      {status && <p className="small" role="status">{status}</p>}
      <ErrorMessage error={test.error ?? poll.error ?? regenerate.error ?? remove.error} />
      <div className="webhook">
        <span className="field-label">URL de réception (webhook)</span>
        <code>{mailbox.webhookUrl}</code>
        <button type="button" className="link" onClick={() => void navigator.clipboard.writeText(mailbox.webhookUrl)}>
          Copier
        </button>
        <button
          type="button"
          className="link"
          onClick={() => window.confirm('Générer une nouvelle URL ? L’ancienne cessera de fonctionner.') && regenerate.mutate(undefined)}
        >
          Régénérer
        </button>
      </div>
    </li>
  );
}

function Mailboxes() {
  const { data, error, isPending } = useQuery({ queryKey: MAILBOXES_KEY, queryFn: adminApi.mailboxes });
  const [editing, setEditing] = useState<Mailbox | 'new' | null>(null);
  return (
    <>
      {editing && <MailboxForm key={editing === 'new' ? 'new' : editing.id} mailbox={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      <section className="card">
        <div className="section-header">
          <h2>Boîtes de réception</h2>
          {!editing && (
            <button type="button" className="primary" onClick={() => setEditing('new')}>
              Nouvelle boîte
            </button>
          )}
        </div>
        <p className="muted small">
          Chaque e-mail reçu crée un ticket ou s'ajoute au ticket existant (en-têtes de réponse ou [TICKET #n] dans le sujet). Les
          réponses des agents partent depuis l'adresse de la boîte du ticket.
        </p>
        <ErrorMessage error={error} />
        {isPending ? (
          <Spinner />
        ) : data?.length === 0 ? (
          <p className="empty">Aucune boîte configurée : les tickets ne se créent pas encore par e-mail.</p>
        ) : (
          <ul className="mailboxes">
            {data?.map((m) => (
              <MailboxRow key={m.id} mailbox={m} onEdit={() => setEditing(m)} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Settings() {
  const { data } = useQuery({ queryKey: ['admin', 'email-settings'], queryFn: adminApi.emailSettings });
  return data ? <SettingsForm key={JSON.stringify(data)} saved={data} /> : <Spinner />;
}

function SettingsForm({ saved }: { saved: EmailSettings }) {
  const [s, setS] = useState(saved);
  const [blocklist, setBlocklist] = useState(saved.blocklist.join('\n'));
  const save = useAdminMutation(adminApi.saveEmailSettings, [['admin', 'email-settings']]);
  return (
    <section className="card">
      <h2>Réglages de réception</h2>
      <ErrorMessage error={save.error} />
      <label className="checkbox">
        <input type="checkbox" checked={s.acknowledge} onChange={(e) => setS({ ...s, acknowledge: e.target.checked })} />
        Envoyer un accusé de réception à la création d'un ticket par e-mail (texte : macro « Accusé de réception »)
      </label>
      <Field label="Expéditeurs bloqués (une adresse ou un @domaine par ligne) — traités comme spam">
        <textarea rows={4} value={blocklist} onChange={(e) => setBlocklist(e.target.value)} placeholder={'promo@exemple.com\n@spam.example'} />
      </Field>
      <Field label="Au-delà de ce nombre de messages par heure d'un même expéditeur, on suppose une boucle">
        <input
          type="number"
          className="narrow"
          min={1}
          value={s.maxPerSenderPerHour}
          onChange={(e) => setS({ ...s, maxPerSenderPerHour: Number(e.target.value) })}
        />
      </Field>
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={save.isPending}
          onClick={() => save.mutate({ ...s, blocklist: blocklist.split('\n').map((l) => l.trim()).filter(Boolean) })}
        >
          Enregistrer
        </button>
      </div>
    </section>
  );
}

function InboundJournal() {
  const [status, setStatus] = useState<InboundStatus | ''>('');
  const { data, error, isPending } = useQuery({
    queryKey: ['admin', 'inbound', status],
    queryFn: () => adminApi.inboundLog(status || undefined),
    refetchInterval: 30_000,
  });
  const retry = useAdminMutation(adminApi.retryInbound, [['admin', 'inbound']]);
  return (
    <section className="card">
      <div className="section-header">
        <h2>Journal des réceptions</h2>
        <select aria-label="Filtrer par résultat" value={status} onChange={(e) => setStatus(e.target.value as InboundStatus | '')}>
          <option value="">Tous les résultats</option>
          {Object.entries(INBOUND_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <ErrorMessage error={error ?? retry.error} />
      {isPending ? (
        <Spinner />
      ) : data?.items.length === 0 ? (
        <p className="empty">Aucun e-mail reçu.</p>
      ) : (
        <div className="table-wrap flat">
          <table className="tickets">
            <thead>
              <tr>
                <th>Reçu le</th>
                <th>Expéditeur</th>
                <th>Sujet</th>
                <th>Résultat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{formatDate(m.receivedAt)}</td>
                  <td>{m.fromAddress}</td>
                  <td>{m.subject || <span className="muted">(sans objet)</span>}</td>
                  <td>
                    <span className={`badge inbound-${m.status.toLowerCase()}`}>{INBOUND_LABELS[m.status]}</span>
                    {m.reason && <div className="muted small">{m.reason}</div>}
                  </td>
                  <td className="row-actions">
                    {m.ticketId && <Link to={`/tickets/${m.ticketId}`}>#{m.ticketId}</Link>}
                    {m.canRetry && (
                      <button type="button" className="link" disabled={retry.isPending} onClick={() => retry.mutate(m.id)}>
                        Retraiter
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FailedSends() {
  const { data } = useQuery({ queryKey: ['admin', 'outbound', 'FAILED'], queryFn: () => adminApi.outboundLog('FAILED') });
  const retry = useAdminMutation(adminApi.retryOutbound, [['admin', 'outbound', 'FAILED']]);
  if (!data?.length) return null;
  return (
    <section className="card">
      <h2>Envois en échec ({data.length})</h2>
      <ErrorMessage error={retry.error} />
      <ul className="option-list">
        {data.map((o) => (
          <li key={o.id} className="option-row">
            <span className="view-name">
              <strong>
                <Link to={`/tickets/${o.ticketId}`}>{o.subject}</Link> → {o.toAddress}
              </strong>
              <span className="muted small">
                {o.attempts} tentative(s) · {o.lastError}
              </span>
            </span>
            <span className="row-actions">
              <button type="button" className="link" onClick={() => retry.mutate(o.id)}>
                Réessayer
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MailAdmin() {
  const [tab, setTab] = useState<'boxes' | 'journal' | 'settings'>('boxes');
  return (
    <div className="admin-section">
      <div className="segmented" role="tablist" aria-label="Messagerie">
        <button type="button" role="tab" aria-selected={tab === 'boxes'} onClick={() => setTab('boxes')}>
          Boîtes de réception
        </button>
        <button type="button" role="tab" aria-selected={tab === 'journal'} onClick={() => setTab('journal')}>
          Journal
        </button>
        <button type="button" role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>
          Réglages
        </button>
      </div>
      {tab === 'boxes' && <Mailboxes />}
      {tab === 'journal' && (
        <>
          <FailedSends />
          <InboundJournal />
        </>
      )}
      {tab === 'settings' && <Settings />}
    </div>
  );
}
