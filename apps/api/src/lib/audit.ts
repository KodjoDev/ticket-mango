export type Changes = Record<string, { from: unknown; to: unknown }>;

/** Calcule les champs de `next` dont la valeur diffère de `prev`. */
export function diff<T extends object>(prev: T, next: Partial<T>): Changes {
  const changes: Changes = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    const from = prev[key] ?? null;
    const to = next[key] ?? null;
    const same = from instanceof Date && to instanceof Date ? from.getTime() === to.getTime() : from === to;
    if (!same) changes[key as string] = { from, to };
  }
  return changes;
}
