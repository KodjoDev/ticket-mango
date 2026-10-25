import { computePriority, DEFAULT_PRIORITY_MATRIX, IMPACTS, isMajorIncidentPriority, URGENCIES } from './priority';

describe('computePriority', () => {
  it.each([
    ['INDIVIDUAL', 'LOW', 'P4'],
    ['INDIVIDUAL', 'CRITICAL', 'P2'],
    ['TEAM', 'MEDIUM', 'P3'],
    ['TEAM', 'CRITICAL', 'P1'],
    ['ORGANIZATION', 'LOW', 'P3'],
    ['ORGANIZATION', 'HIGH', 'P1'],
    ['ORGANIZATION', 'CRITICAL', 'P0'],
  ] as const)('%s × %s → %s', (impact, urgency, expected) => {
    expect(computePriority(impact, urgency)).toBe(expected);
  });

  it('couvre toutes les combinaisons impact × urgence', () => {
    for (const impact of IMPACTS) {
      for (const urgency of URGENCIES) {
        expect(DEFAULT_PRIORITY_MATRIX[impact][urgency]).toMatch(/^P[0-4]$/);
      }
    }
  });

  it('ne baisse jamais la priorité quand l’urgence ou l’impact augmente', () => {
    const rank = (i: number, u: number) =>
      Number(computePriority(IMPACTS[i]!, URGENCIES[u]!).slice(1));
    for (let i = 0; i < IMPACTS.length; i++) {
      for (let u = 0; u < URGENCIES.length; u++) {
        if (u > 0) expect(rank(i, u)).toBeLessThanOrEqual(rank(i, u - 1));
        if (i > 0) expect(rank(i, u)).toBeLessThanOrEqual(rank(i - 1, u));
      }
    }
  });

  it('accepte une matrice personnalisée', () => {
    const matrix = structuredClone(DEFAULT_PRIORITY_MATRIX);
    matrix.INDIVIDUAL.LOW = 'P3';
    expect(computePriority('INDIVIDUAL', 'LOW', matrix)).toBe('P3');
  });
});

describe('isMajorIncidentPriority', () => {
  it('ne concerne que P0 et P1', () => {
    expect(isMajorIncidentPriority('P0')).toBe(true);
    expect(isMajorIncidentPriority('P1')).toBe(true);
    expect(isMajorIncidentPriority('P2')).toBe(false);
  });
});
