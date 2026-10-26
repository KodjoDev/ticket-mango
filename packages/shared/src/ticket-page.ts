/**
 * Disposition de la page d'un ticket : blocs ordonnés répartis en deux colonnes.
 */

export const PAGE_BLOCKS = [
  'description',
  'meetings',
  'conversation',
  'requesterHistory',
  'history',
  'requester',
  'sla',
  'status',
  'qualification',
  'assignment',
  'devLinks',
  'referent',
  'merge',
  'dates',
] as const;
export type PageBlock = (typeof PAGE_BLOCKS)[number];

export const PAGE_BLOCK_LABELS: Record<PageBlock, string> = {
  description: 'Description',
  meetings: 'Rendez-vous',
  conversation: 'Conversation',
  requesterHistory: 'Historique du demandeur',
  history: 'Historique du ticket',
  requester: 'Demandeur',
  sla: 'SLA',
  status: 'Statut',
  qualification: 'Qualification et champs',
  assignment: 'Assignation',
  devLinks: 'Issues Jira / GitHub',
  referent: 'Ticket référent',
  merge: 'Fusion',
  dates: 'Dates',
};

export const PAGE_COLUMNS = ['main', 'side'] as const;
export type PageColumn = (typeof PAGE_COLUMNS)[number];

export const PAGE_COLUMN_LABELS: Record<PageColumn, string> = { main: 'Centre', side: 'Panneau de gauche' };

export interface PageBlockItem {
  key: PageBlock;
  visible: boolean;
  column: PageColumn;
}

/** Blocs qui ne peuvent pas être masqués : on ne peut ni répondre ni voir la demande sans eux. */
export const LOCKED_PAGE_BLOCKS: PageBlock[] = ['description', 'conversation'];

const MAIN_BLOCKS: PageBlock[] = ['description', 'meetings', 'conversation', 'requesterHistory', 'history'];

const defaultColumn = (key: PageBlock): PageColumn => (MAIN_BLOCKS.includes(key) ? 'main' : 'side');

/** Ordre historique : panneau de gauche (demandeur, SLA, statut…), puis centre. */
export const DEFAULT_TICKET_PAGE: PageBlockItem[] = [
  ...PAGE_BLOCKS.filter((k) => defaultColumn(k) === 'side'),
  ...PAGE_BLOCKS.filter((k) => defaultColumn(k) === 'main'),
].map((key) => ({ key, visible: true, column: defaultColumn(key) }));

/**
 * Complète une disposition enregistrée : éléments inconnus ignorés, doublons retirés, blocs ajoutés depuis
 * placés à la fin de leur colonne par défaut, blocs verrouillés toujours visibles.
 */
export function normalizeTicketPage(saved: unknown): PageBlockItem[] {
  const items = Array.isArray(saved) ? (saved as Partial<PageBlockItem>[]) : [];
  const seen = new Set<PageBlock>();
  const known: PageBlockItem[] = [];
  for (const i of items) {
    if (!i || !PAGE_BLOCKS.includes(i.key as PageBlock) || seen.has(i.key as PageBlock)) continue;
    if (typeof i.visible !== 'boolean' || !PAGE_COLUMNS.includes(i.column as PageColumn)) continue;
    seen.add(i.key as PageBlock);
    known.push({ key: i.key as PageBlock, visible: i.visible, column: i.column as PageColumn });
  }
  const added = DEFAULT_TICKET_PAGE.filter((i) => !seen.has(i.key));
  return [...known, ...added].map((i) => (LOCKED_PAGE_BLOCKS.includes(i.key) ? { ...i, visible: true } : i));
}

/** Blocs visibles d'une colonne, dans l'ordre de la disposition. */
export function blocksOf(layout: PageBlockItem[], column: PageColumn): PageBlock[] {
  return layout.filter((i) => i.visible && i.column === column).map((i) => i.key);
}
