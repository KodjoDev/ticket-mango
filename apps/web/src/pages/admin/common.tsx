import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CONFIG_QUERY_KEY } from '../../config/ConfigContext';

/** Déplace un élément d'une position (delta = -1 vers le haut, +1 vers le bas). */
export function move<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function OrderButtons({
  index,
  count,
  onMove,
  disabled,
  label,
}: {
  index: number;
  count: number;
  onMove: (delta: number) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <span className="order-buttons">
      <button type="button" className="icon" aria-label={`Monter ${label}`} disabled={disabled || index === 0} onClick={() => onMove(-1)}>
        ↑
      </button>
      <button
        type="button"
        className="icon"
        aria-label={`Descendre ${label}`}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
      >
        ↓
      </button>
    </span>
  );
}

/** Mutation d'administration : recharge la configuration et les vues une fois appliquée. */
export function useAdminMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, extraKeys: string[][] = []) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of [CONFIG_QUERY_KEY, ['views'], ...extraKeys]) void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** Clé de liste dérivée d'un libellé : « Application mobile » → APPLICATION_MOBILE. */
export function keyFromLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'K_$1')
    .slice(0, 40);
}
