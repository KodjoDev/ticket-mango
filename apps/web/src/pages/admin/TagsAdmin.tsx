import { useState, type FormEvent } from 'react';
import { adminApi } from '../../api/client';
import type { Tag } from '../../api/types';
import { TagChip } from '../../components/tags';
import { ErrorMessage, Field } from '../../components/ui';
import { useConfig } from '../../config/ConfigContext';
import { useAdminMutation } from './common';

const PALETTE = ['#1f73b7', '#038153', '#cc3340', '#ad5918', '#6a27b8', '#17494d', '#5c6970', '#c72a1c'];

function TagRow({ tag }: { tag: Tag }) {
  const [name, setName] = useState(tag.name);
  const update = useAdminMutation((input: Partial<{ name: string; color: string; isActive: boolean }>) =>
    adminApi.updateTag(tag.id, input),
  );
  const remove = useAdminMutation(() => adminApi.deleteTag(tag.id));

  return (
    <li className={tag.isActive ? 'option-row' : 'option-row inactive'}>
      <input
        type="color"
        aria-label={`Couleur de ${tag.name}`}
        value={tag.color}
        onChange={(e) => update.mutate({ color: e.target.value })}
      />
      <input
        aria-label={`Nom du tag ${tag.name}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== tag.name && update.mutate({ name: name.trim() })}
      />
      <TagChip tag={tag} />
      <span className="badges">{!tag.isActive && <span className="badge archived-badge">Archivé</span>}</span>
      <span className="row-actions">
        <button type="button" className="link" disabled={update.isPending} onClick={() => update.mutate({ isActive: !tag.isActive })}>
          {tag.isActive ? 'Archiver' : 'Réactiver'}
        </button>
        <button
          type="button"
          className="link danger"
          disabled={remove.isPending}
          onClick={() => window.confirm(`Supprimer le tag « ${tag.name} » ?`) && remove.mutate(undefined)}
        >
          Supprimer
        </button>
      </span>
      {(update.error || remove.error) && (
        <div className="row-error">
          <ErrorMessage error={update.error ?? remove.error} />
        </div>
      )}
    </li>
  );
}

export function TagsAdmin() {
  const config = useConfig();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]!);
  const create = useAdminMutation(adminApi.createTag);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { name: name.trim(), color },
      { onSuccess: () => { setName(''); setColor(PALETTE[(config.tags.length + 1) % PALETTE.length]!); } },
    );
  }

  return (
    <div className="admin-section">
      <section className="card">
        <h2>Tags ({config.tags.length})</h2>
        <p className="muted small">
          Les agents appliquent ces tags aux tickets. Un tag utilisé ne peut pas être supprimé : archivez-le pour ne plus le
          proposer.
        </p>
        <ul className="option-list">
          {config.tags.map((t) => (
            <TagRow key={t.id} tag={t} />
          ))}
        </ul>
        <form className="add-row" onSubmit={onSubmit}>
          <ErrorMessage error={create.error} />
          <Field label="Couleur">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </Field>
          <Field label="Nom du tag">
            <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <button type="submit" className="primary" disabled={create.isPending}>
            Ajouter
          </button>
        </form>
      </section>
    </div>
  );
}
