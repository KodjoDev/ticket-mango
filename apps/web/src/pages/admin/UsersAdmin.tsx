import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, ROLES, type Role } from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { adminApi } from '../../api/client';
import type { ManagedUser } from '../../api/types';
import { useCurrentUser } from '../../auth/AuthContext';
import { Avatar, ErrorMessage, Field, formatDate, options, Spinner } from '../../components/ui';
import { useAdminMutation } from './common';

const USERS_KEY = ['admin', 'users'];

function CreateUserForm() {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'AGENT_N1' as Role });
  const create = useAdminMutation(adminApi.createUser, [USERS_KEY, ['agents']]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate(form, { onSuccess: () => setForm({ name: '', email: '', password: '', role: form.role }) });
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Nouvel utilisateur</h2>
      <ErrorMessage error={create.error} />
      <div className="grid-4">
        <Field label="Nom">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Mot de passe initial">
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            placeholder="12 caractères minimum"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <Field label="Rôle">
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {options(ROLES, ROLE_LABELS)}
          </select>
        </Field>
      </div>
      <div className="actions">
        <button type="submit" className="primary" disabled={create.isPending}>
          Créer l'utilisateur
        </button>
      </div>
    </form>
  );
}

function UserRow({ user, isSelf }: { user: ManagedUser; isSelf: boolean }) {
  const update = useAdminMutation(
    (input: Parameters<typeof adminApi.updateUser>[1]) => adminApi.updateUser(user.id, input),
    [USERS_KEY, ['agents']],
  );
  const [password, setPassword] = useState<string | null>(null);

  return (
    <tr className={user.isActive ? undefined : 'inactive'}>
      <td>
        <span className="assignee-cell">
          <Avatar name={user.name} size="sm" />
          <span>
            <strong>{user.name}</strong>
            {isSelf && <span className="muted small"> (vous)</span>}
            <div className="muted small">{user.email}</div>
          </span>
        </span>
        <ErrorMessage error={update.error} />
      </td>
      <td>
        <select
          aria-label={`Rôle de ${user.name}`}
          value={user.role}
          disabled={isSelf || update.isPending}
          onChange={(e) => update.mutate({ role: e.target.value as Role })}
        >
          {options(ROLES, ROLE_LABELS)}
        </select>
      </td>
      <td>{user.isActive ? 'Actif' : <span className="muted">Désactivé</span>}</td>
      <td className="nowrap muted">{formatDate(user.createdAt)}</td>
      <td className="row-actions">
        {password === null ? (
          <>
            <button type="button" className="link" onClick={() => setPassword('')}>
              Réinitialiser le mot de passe
            </button>
            {!isSelf && (
              <button type="button" className="link" disabled={update.isPending} onClick={() => update.mutate({ isActive: !user.isActive })}>
                {user.isActive ? 'Désactiver' : 'Réactiver'}
              </button>
            )}
          </>
        ) : (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate({ password }, { onSuccess: () => setPassword(null) });
            }}
          >
            <input
              type="password"
              aria-label={`Nouveau mot de passe de ${user.name}`}
              autoComplete="new-password"
              placeholder="Nouveau mot de passe (12+)"
              minLength={12}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit" className="primary">
              Valider
            </button>
            <button type="button" onClick={() => setPassword(null)}>
              Annuler
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

export function UsersAdmin() {
  const me = useCurrentUser();
  const { data, error, isPending } = useQuery({ queryKey: USERS_KEY, queryFn: adminApi.users });
  const [showInactive, setShowInactive] = useState(false);
  const users = (data ?? []).filter((u) => showInactive || u.isActive);

  return (
    <div className="admin-section">
      <CreateUserForm />
      <section className="card">
        <div className="section-header">
          <h2>Utilisateurs ({data?.length ?? 0})</h2>
          <label className="checkbox">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Afficher les comptes désactivés
          </label>
        </div>
        <ErrorMessage error={error} />
        {isPending ? (
          <Spinner />
        ) : (
          <div className="table-wrap flat">
            <table className="tickets">
              <thead>
                <tr>
                  <th>Utilisateur</th>
                  <th>Rôle</th>
                  <th>État</th>
                  <th>Créé le</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <UserRow key={u.id} user={u} isSelf={u.id === me.id} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
