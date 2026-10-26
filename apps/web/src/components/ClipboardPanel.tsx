import { useEffect, useRef, useState } from 'react';
import { copyText } from '../clipboard/copy';
import { useClipboardHistory } from '../clipboard/ClipboardContext';
import { formatDate } from './ui';

/** Historique des copies : cliquer sur un élément le recopie dans le presse-papiers. */
export function ClipboardPanel() {
  const { items, remove, clear } = useClipboardHistory();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => panel.current && !panel.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function recopy(id: string, text: string) {
    if (await copyText(text)) {
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    }
  }

  return (
    <div className="bell" ref={panel}>
      <button
        type="button"
        className="bell-button"
        aria-label={`Historique des copies (${items.length})`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"
          />
        </svg>
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Historique des copies">
          <div className="bell-header">
            <strong>Historique des copies</strong>
            {items.length > 0 && (
              <button type="button" className="link" onClick={clear}>
                Tout effacer
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="muted small bell-empty">Rien copié pour l’instant. Les textes copiés dans l’application apparaîtront ici.</p>
          ) : (
            <ul>
              {items.map((c) => (
                <li key={c.id} className="clip-item">
                  <button type="button" className="bell-item" onClick={() => void recopy(c.id, c.text)}>
                    <span className="clip-text">{c.text}</span>
                    <span className="muted small">{copied === c.id ? 'Copié ✓' : formatDate(new Date(c.at).toISOString())}</span>
                  </button>
                  <button type="button" className="link danger" aria-label="Retirer de l’historique" onClick={() => remove(c.id)}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small bell-empty">Conservé dans ce navigateur seulement, effacé à la déconnexion.</p>
        </div>
      )}
    </div>
  );
}
