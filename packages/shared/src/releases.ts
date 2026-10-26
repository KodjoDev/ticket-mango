/**
 * Release notes (CdC §5) : catégories et classement par défaut des tickets livrés.
 */

export const RELEASE_CATEGORIES = ['NEW', 'FIX', 'ARCHITECTURE'] as const;
export type ReleaseCategory = (typeof RELEASE_CATEGORIES)[number];

export const RELEASE_CATEGORY_LABELS: Record<ReleaseCategory, string> = {
  NEW: 'Nouveautés',
  FIX: 'Corrections',
  ARCHITECTURE: 'Architecture',
};

/** Classement proposé à l'ajout d'un ticket ; modifiable ensuite. */
export function defaultReleaseCategory(type: string): ReleaseCategory {
  if (type === 'FEATURE_REQUEST') return 'NEW';
  if (type === 'BUG' || type === 'MAJOR_INCIDENT') return 'FIX';
  return 'ARCHITECTURE';
}

export interface ReleaseNoteItem {
  ticketId: number;
  category: ReleaseCategory;
  subject: string;
  summary: string | null;
  component: string | null;
}

export interface CompiledNotes {
  /** Lecture interne : tous les tickets, avec leur numéro. */
  technical: { category: ReleaseCategory; items: { ticketId: number; text: string; component: string | null }[] }[];
  /** Lecture clients : seuls les tickets ayant un résumé vulgarisé, sans numéro ni jargon. */
  customer: { category: ReleaseCategory; items: { text: string }[] }[];
}

/** Compile les notes à deux niveaux ; les catégories vides sont omises. */
export function compileNotes(items: ReleaseNoteItem[]): CompiledNotes {
  const technical: CompiledNotes['technical'] = [];
  const customer: CompiledNotes['customer'] = [];
  for (const category of RELEASE_CATEGORIES) {
    const inCategory = items.filter((i) => i.category === category).sort((a, b) => a.ticketId - b.ticketId);
    if (inCategory.length) {
      technical.push({
        category,
        items: inCategory.map((i) => ({ ticketId: i.ticketId, text: i.subject, component: i.component })),
      });
    }
    const visible = inCategory.filter((i) => i.summary?.trim());
    if (visible.length) customer.push({ category, items: visible.map((i) => ({ text: i.summary!.trim() })) });
  }
  return { technical, customer };
}
