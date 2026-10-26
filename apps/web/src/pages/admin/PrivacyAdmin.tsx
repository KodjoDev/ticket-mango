import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi } from '../../api/client';
import type { PurgeResult } from '../../api/types';
import { ErrorMessage, Field, Spinner } from '../../components/ui';
import { useAdminMutation } from './common';

const USERS_KEY = ['admin', 'users'];

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function PersonData() {
  const { data: users, isPending } = useQuery({ queryKey: USERS_KEY, queryFn: adminApi.users });
  const [userId, setUserId] = useState('');
  const [erase, setErase] = useState(false);
  const exportData = useAdminMutation(async () => download(`donnees-${userId}.json`, await adminApi.exportUser(userId)), [USERS_KEY]);
  const anonymize = useAdminMutation(() => adminApi.anonymizeUser(userId, erase), [USERS_KEY]);
  const user = users?.find((u) => u.id === userId);
  return (
    <section className="card">
      <h2>Données d’une personne</h2>
      <p className="muted small">
        Export (droit d’accès) et anonymisation (droit à l’effacement). L’anonymisation est définitive : l’identité est effacée, le compte désactivé et les
        journaux d’e-mails nettoyés. Les tickets sont conservés pour l’historique et les statistiques.
      </p>
      <ErrorMessage error={exportData.error ?? anonymize.error} />
      {isPending ? (
        <Spinner />
      ) : (
        <Field label="Personne">
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— choisir —</option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
        </Field>
      )}
      <label className="checkbox">
        <input type="checkbox" checked={erase} onChange={(e) => setErase(e.target.checked)} />
        Effacer aussi ses messages, la description de ses tickets et leurs pièces jointes
      </label>
      {anonymize.isSuccess && <p role="status">Personne anonymisée.</p>}
      <div className="actions">
        <button type="button" disabled={!userId || exportData.isPending} onClick={() => exportData.mutate(undefined)}>
          Exporter (JSON)
        </button>
        <button
          type="button"
          className="danger"
          disabled={!userId || anonymize.isPending}
          onClick={() =>
            window.confirm(`Anonymiser définitivement ${user?.name ?? 'cette personne'}${erase ? ' et effacer ses contenus' : ''} ? Cette action est irréversible.`) &&
            anonymize.mutate(undefined)
          }
        >
          Anonymiser
        </button>
      </div>
    </section>
  );
}

function Purge() {
  const [months, setMonths] = useState(24);
  const [result, setResult] = useState<PurgeResult | null>(null);
  const run = useAdminMutation((dryRun: boolean) => adminApi.purge(months, dryRun), [USERS_KEY]);
  const go = (dryRun: boolean) => run.mutate(dryRun, { onSuccess: setResult });
  return (
    <section className="card">
      <h2>Purge de conservation</h2>
      <p className="muted small">
        Anonymise les utilisateurs externes dont tous les tickets sont clos depuis plus de la durée choisie (6 mois au minimum) et supprime les journaux
        d’e-mails reçus plus anciens. Lancez d’abord une simulation.
      </p>
      <ErrorMessage error={run.error} />
      <Field label="Durée de conservation (mois)">
        <input type="number" min={6} max={120} value={months} onChange={(e) => setMonths(Number(e.target.value))} />
      </Field>
      {result && (
        <p role="status">
          {result.dryRun ? 'Simulation' : 'Purge effectuée'} : {result.users} utilisateur(s) et {result.emailLogs} journal(aux) d’e-mails concernés.
        </p>
      )}
      <div className="actions">
        <button type="button" disabled={run.isPending} onClick={() => go(true)}>
          Simuler
        </button>
        <button
          type="button"
          className="danger"
          disabled={run.isPending}
          onClick={() => window.confirm(`Lancer la purge (${months} mois) ? Elle est irréversible.`) && go(false)}
        >
          Purger
        </button>
      </div>
    </section>
  );
}

export function PrivacyAdmin() {
  return (
    <div className="admin-section">
      <PersonData />
      <Purge />
      <section className="card">
        <h2>Chiffrement</h2>
        <p className="muted small">
          Les identifiants stockés (mots de passe IMAP, jetons Jira et GitHub, destinations d’alerte) sont chiffrés en AES-256-GCM avec SECRET_KEY. Les mots
          de passe des comptes sont hachés. Le chiffrement en transit (TLS) est assuré par le reverse proxy devant l’application : l’application doit n’être
          exposée qu’en HTTPS.
        </p>
      </section>
    </div>
  );
}
