import { hasPermission, PERMISSIONS } from './rbac';

describe('RBAC', () => {
  it('donne toutes les permissions à l’administrateur', () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission('ADMIN', permission)).toBe(true);
    }
  });

  it('cantonne le lecteur à la lecture', () => {
    expect(hasPermission('READER', 'ticket:read:all')).toBe(true);
    expect(hasPermission('READER', 'ticket:create')).toBe(false);
    expect(hasPermission('READER', 'comment:create')).toBe(false);
  });

  it('réserve le forçage de priorité au N2', () => {
    expect(hasPermission('AGENT_N1', 'ticket:priority:override')).toBe(false);
    expect(hasPermission('AGENT_N2', 'ticket:priority:override')).toBe(true);
  });

  it('empêche l’utilisateur externe de voir les autres tickets et les notes internes', () => {
    expect(hasPermission('EXTERNAL_USER', 'ticket:read:all')).toBe(false);
    expect(hasPermission('EXTERNAL_USER', 'comment:internal')).toBe(false);
    expect(hasPermission('EXTERNAL_USER', 'ticket:transition')).toBe(false);
  });

  it('réserve l’administration à l’administrateur', () => {
    expect(hasPermission('AGENT_N2', 'user:manage')).toBe(false);
    expect(hasPermission('AGENT_N2', 'settings:manage')).toBe(false);
  });
});
