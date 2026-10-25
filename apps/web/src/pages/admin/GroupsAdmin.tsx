import { useQuery } from '@tanstack/react-query';
import { hasPermission } from '@ticketing/shared';
import { useState, type FormEvent } from 'react';
import { adminApi } from '../../api/client';
import type { AdminGroup, Distribution } from '../../api/types';
import { ErrorMessage, Field, Spinner } from '../../components/ui';
import { useAdminMutation } from './common';

const GROUPS_KEY = ['admin', 'groups'];
export const DISTRIBUTION_LABELS: Record<Distribution, string> = {
  ROUND_ROBIN: 'Tour de rôle',
  LOAD: 'Par charge de travail',
  MANUAL: 'Manuelle (dispatcher)',
};
const DISTRIBUTION_HELP: Record<Distribution, string> = {
  ROUND_ROBIN: 'Chaque nouveau ticket va à l’agent suivant du groupe.',
  LOAD: 'Chaque nouveau ticket va à l’agent qui a le moins de tickets ouverts.',
  MANUAL: 'Les tickets restent dans la file du groupe jusqu’à ce qu’un agent les assigne.',
};

function GroupForm({ group, onDone }: { group?: AdminGroup; onDone: () => void }) {
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: adminApi.users });
  const agents = (users.data ?? []).filter((u) => u.isActive && hasPermission(u.role, 'ticket:transition'));
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [distribution, setDistribution] = useState<Distribution>(group?.distribution ?? 'ROUND_ROBIN');
  const [managerId, setManagerId] = useState(group?.managerId ?? '');
  const [memberIds, setMemberIds] = useState<string[]>(group?.members.map((m) => m.id) ?? []);
  const save = useAdminMutation(
    (input: Parameters<typeof adminApi.createGroup>[0]) => (group ? adminApi.updateGroup(group.id, input) : adminApi.createGroup(input)),
    [GROUPS_KEY],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(
      { name: name.trim(), description: description.trim() || null, distribution, managerId: managerId || null, memberIds },
      { onSuccess: onDone },
    );
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>{group ? `Modifier « ${group.name} »` : 'Nouveau groupe'}</h2>
      <ErrorMessage error={save.error} />
      <div className="grid-3">
        <Field label="Nom">
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Distribution">
          <select value={distribution} onChange={(e) => setDistribution(e.target.value as Distribution)}>
            {Object.entries(DISTRIBUTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Responsable (alertes SLA)">
          <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">Aucun</option>
            {agents.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="muted small">{DISTRIBUTION_HELP[distribution]}</p>
      <Field label="Description">
        <input maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <fieldset className="checks">
        <legend className="field-label">Membres</legend>
        {users.isPending && <Spinner />}
        {agents.map((u) => (
          <label key={u.id} className="checkbox">
            <input
              type="checkbox"
              checked={memberIds.includes(u.id)}
              onChange={(e) => setMemberIds(e.target.checked ? [...memberIds, u.id] : memberIds.filter((id) => id !== u.id))}
            />
            {u.name}
          </label>
        ))}
      </fieldset>
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

export function GroupsAdmin() {
  const { data: groups, error, isPending } = useQuery({ queryKey: GROUPS_KEY, queryFn: adminApi.groups });
  const [editing, setEditing] = useState<AdminGroup | 'new' | null>(null);
  const toggle = useAdminMutation(({ id, isActive }: { id: string; isActive: boolean }) => adminApi.updateGroup(id, { isActive }), [GROUPS_KEY]);
  const remove = useAdminMutation(adminApi.deleteGroup, [GROUPS_KEY]);

  return (
    <div className="admin-section">
      {editing && <GroupForm key={editing === 'new' ? 'new' : editing.id} group={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      <section className="card">
        <div className="section-header">
          <h2>Groupes d'agents</h2>
          {!editing && (
            <button type="button" className="primary" onClick={() => setEditing('new')}>
              Nouveau groupe
            </button>
          )}
        </div>
        <ErrorMessage error={error ?? toggle.error ?? remove.error} />
        {isPending ? (
          <Spinner />
        ) : (
          <ul className="option-list">
            {(groups ?? []).map((g) => (
              <li key={g.id} className={g.isActive ? 'option-row' : 'option-row inactive'}>
                <span className="view-name">
                  <strong>{g.name}</strong>
                  <span className="muted small">
                    {DISTRIBUTION_LABELS[g.distribution]} · {g.members.length} membre(s)
                    {g.manager && ` · responsable : ${g.manager.name}`} · {g.ticketCount} ticket(s)
                  </span>
                </span>
                <span className="row-actions">
                  {!g.isActive && <span className="badge archived-badge">Inactif</span>}
                  <button type="button" className="link" onClick={() => setEditing(g)}>
                    Modifier
                  </button>
                  <button type="button" className="link" onClick={() => toggle.mutate({ id: g.id, isActive: !g.isActive })}>
                    {g.isActive ? 'Désactiver' : 'Activer'}
                  </button>
                  {g.ticketCount === 0 && (
                    <button
                      type="button"
                      className="link danger"
                      onClick={() => window.confirm(`Supprimer le groupe « ${g.name} » ?`) && remove.mutate(g.id)}
                    >
                      Supprimer
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
