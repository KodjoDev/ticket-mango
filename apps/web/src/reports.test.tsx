import { screen } from '@testing-library/react';
import type { Report } from '@ticketing/shared';
import { agent, mockApi, renderApp } from './test/utils';

describe('statistiques', () => {
  it('affiche les indicateurs et le top des modules', async () => {
    const report: Report = {
      total: 12,
      byChannel: [{ key: 'EMAIL', count: 8 }, { key: 'WEB', count: 4 }],
      byType: [{ key: 'BUG', count: 12 }],
      byPriority: [{ key: 'P2', count: 12 }],
      avgFirstResponseMinutes: 45,
      avgResolutionMinutes: 150,
      slaCompliance: 0.75,
      topBugComponents: [{ key: 'AUTH', count: 5 }],
    };
    mockApi({
      'GET /auth/me': { ...agent, role: 'AGENT_N2' },
      'GET /views': [],
      'GET /notifications': { items: [], unread: 0 },
      'GET /public/status': { operational: true, active: [], recent: [] },
      'GET /reports': report,
    });
    renderApp('/reports');
    expect(await screen.findByText('75 %')).toBeInTheDocument();
    expect(screen.getByText('45 min')).toBeInTheDocument();
    expect(screen.getByText('2 h 30')).toBeInTheDocument();
    expect(screen.getByText('E-mail')).toBeInTheDocument();
    expect(screen.getByText('AUTH')).toBeInTheDocument();
  });
});
