import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface ClipItem {
  id: string;
  text: string;
  at: number;
}

export const MAX_CLIPS = 20;
const MAX_LENGTH = 2000;
const storageKey = (userId: string) => `ticket-mango:clipboard:${userId}`;

function load(userId: string): ClipItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((c): c is ClipItem => typeof c?.id === 'string' && typeof c?.text === 'string' && typeof c?.at === 'number').slice(0, MAX_CLIPS)
      : [];
  } catch {
    return [];
  }
}

function save(userId: string, items: ClipItem[]) {
  try {
    if (items.length) localStorage.setItem(storageKey(userId), JSON.stringify(items));
    else localStorage.removeItem(storageKey(userId));
  } catch {
    // Stockage indisponible (navigation privée, quota) : l'historique reste en mémoire.
  }
}

/** Texte sélectionné au moment d'une copie, y compris dans un champ de saisie. */
function selectedText(): string {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // Un mot de passe ne doit jamais entrer dans l'historique.
    if (el instanceof HTMLInputElement && el.type === 'password') return '';
    return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  }
  return window.getSelection()?.toString() ?? '';
}

interface ClipboardValue {
  items: ClipItem[];
  remove: (id: string) => void;
  clear: () => void;
}

const ClipboardContext = createContext<ClipboardValue | null>(null);

/**
 * Historique des dernières copies faites par la personne dans l'application (Ctrl+C / Cmd+C).
 * Stocké dans ce navigateur seulement, par utilisateur, et vidé à la déconnexion.
 * Les boutons « Copier » de l'application (liens secrets) n'y écrivent jamais.
 */
export function ClipboardProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [items, setItems] = useState<ClipItem[]>(() => load(userId));

  const update = useCallback(
    (change: (current: ClipItem[]) => ClipItem[]) =>
      setItems((current) => {
        const next = change(current);
        save(userId, next);
        return next;
      }),
    [userId],
  );

  useEffect(() => {
    const onCopy = () => {
      const text = selectedText().trim().slice(0, MAX_LENGTH);
      if (!text) return;
      update((current) => [{ id: crypto.randomUUID(), text, at: Date.now() }, ...current.filter((c) => c.text !== text)].slice(0, MAX_CLIPS));
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, [update]);

  const value = useMemo<ClipboardValue>(
    () => ({
      items,
      remove: (id) => update((current) => current.filter((c) => c.id !== id)),
      clear: () => update(() => []),
    }),
    [items, update],
  );
  return <ClipboardContext.Provider value={value}>{children}</ClipboardContext.Provider>;
}

export function useClipboardHistory(): ClipboardValue {
  const value = useContext(ClipboardContext);
  if (!value) throw new Error('useClipboardHistory doit être utilisé dans un ClipboardProvider');
  return value;
}
