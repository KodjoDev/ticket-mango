import { useRef } from 'react';
import { attachmentUrl } from '../api/client';
import type { AttachmentRef } from '../api/types';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

export function AttachmentList({ attachments }: { attachments: AttachmentRef[] | undefined }) {
  if (!attachments?.length) return null;
  return (
    <ul className="attachments">
      {attachments.map((a) => (
        <li key={a.id}>
          <a href={attachmentUrl(a.id)} target="_blank" rel="noreferrer">
            📎 {a.filename}
          </a>
          <span className="muted small">{humanSize(a.size)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Sélection de fichiers avant envoi ; les fichiers trop gros sont refusés d'emblée. */
export function FilePicker({
  files,
  onChange,
  disabled,
  onTooLarge,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  onTooLarge: (names: string[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="file-picker">
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Joindre des fichiers"
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          const tooLarge = picked.filter((f) => f.size > MAX_FILE_BYTES);
          if (tooLarge.length) onTooLarge(tooLarge.map((f) => f.name));
          onChange([...files, ...picked.filter((f) => f.size <= MAX_FILE_BYTES)].slice(0, 10));
          e.target.value = '';
        }}
      />
      <button type="button" className="link" disabled={disabled || files.length >= 10} onClick={() => input.current?.click()}>
        📎 Joindre
      </button>
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="tag">
          {f.name} <span className="muted small">{humanSize(f.size)}</span>
          <button type="button" className="link" aria-label={`Retirer ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
