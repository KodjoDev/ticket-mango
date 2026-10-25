import { canTransition, isOpenStatus, STATUS_TRANSITIONS, TICKET_STATUSES } from './workflow';

describe('workflow des tickets', () => {
  it('suit le parcours nominal d’un bug', () => {
    const path = [
      'NEW',
      'QUALIFYING',
      'SENT_TO_DEV',
      'IN_PROGRESS',
      'IN_QA',
      'READY_FOR_RELEASE',
      'RESOLVED',
      'CLOSED',
    ] as const;
    for (let i = 1; i < path.length; i++) {
      expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
    }
  });

  it('met en attente du client depuis la qualification et en revient', () => {
    expect(canTransition('QUALIFYING', 'WAITING_CUSTOMER')).toBe(true);
    expect(canTransition('WAITING_CUSTOMER', 'QUALIFYING')).toBe(true);
    expect(canTransition('NEW', 'WAITING_CUSTOMER')).toBe(false);
  });

  it('autorise la réouverture d’un ticket résolu', () => {
    expect(canTransition('RESOLVED', 'QUALIFYING')).toBe(true);
  });

  it('interdit toute transition depuis CLOSED', () => {
    for (const status of TICKET_STATUSES) {
      expect(canTransition('CLOSED', status)).toBe(false);
    }
  });

  it('interdit de sauter la recette', () => {
    expect(canTransition('IN_PROGRESS', 'READY_FOR_RELEASE')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'RESOLVED')).toBe(false);
  });

  it('n’autorise pas de transition vers le même statut', () => {
    for (const status of TICKET_STATUSES) {
      expect(STATUS_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it('distingue statuts ouverts et fermés', () => {
    expect(isOpenStatus('IN_QA')).toBe(true);
    expect(isOpenStatus('RESOLVED')).toBe(false);
    expect(isOpenStatus('CLOSED')).toBe(false);
  });
});
