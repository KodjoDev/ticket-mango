import { DEFAULT_LIST_COLUMNS, LIST_COLUMNS, normalizeLayout, TICKET_FORM_FIELDS } from './layout';

describe('normalizeLayout', () => {
  it('conserve l’ordre et la visibilité enregistrés', () => {
    const saved = [
      { key: 'urgency', visible: false },
      { key: 'type', visible: true },
    ];
    const layout = normalizeLayout(saved, TICKET_FORM_FIELDS);
    expect(layout.slice(0, 2)).toEqual(saved);
    expect(layout).toHaveLength(TICKET_FORM_FIELDS.length);
  });

  it('ajoute à la fin les éléments absents et ignore les inconnus ou doublons', () => {
    const layout = normalizeLayout(
      [{ key: 'tags', visible: true }, { key: 'inconnu', visible: true }, { key: 'tags', visible: false }],
      TICKET_FORM_FIELDS,
    );
    expect(layout.map((i) => i.key)).toEqual(['tags', 'type', 'component', 'environment', 'impact', 'urgency']);
  });

  it('retombe sur tous les éléments visibles si rien n’est enregistré', () => {
    expect(normalizeLayout(null, LIST_COLUMNS).every((i) => i.visible)).toBe(true);
  });

  it('masque quelques colonnes par défaut', () => {
    expect(DEFAULT_LIST_COLUMNS.find((c) => c.key === 'requester')?.visible).toBe(false);
  });
});
