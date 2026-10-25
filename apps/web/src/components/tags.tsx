import type { Tag, TagRef } from '../api/types';

export function TagChip({ tag }: { tag: TagRef }) {
  return (
    <span className="tag" style={{ borderColor: tag.color, color: tag.color }}>
      <span className="tag-dot" style={{ background: tag.color }} aria-hidden="true" />
      {tag.name}
    </span>
  );
}

export function TagList({ tags }: { tags: TagRef[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="tag-list">
      {tags.map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
    </span>
  );
}

interface PickerProps {
  choices: Tag[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

/** Sélection de tags par bascule : un clic ajoute, un second retire. */
export function TagPicker({ choices, selected, onChange, disabled }: PickerProps) {
  if (choices.length === 0) return <p className="muted small">Aucun tag défini par l'administrateur.</p>;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  return (
    <div className="tag-picker" role="group" aria-label="Tags">
      {choices.map((tag) => {
        const on = selected.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            className={on ? 'tag-toggle on' : 'tag-toggle'}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => toggle(tag.id)}
            style={on ? { background: tag.color, borderColor: tag.color } : { borderColor: tag.color, color: tag.color }}
          >
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}
