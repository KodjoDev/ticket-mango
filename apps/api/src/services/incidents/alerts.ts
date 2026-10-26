import type { AlertKindName, IncidentSeverity, IncidentStatus } from '@ticketing/shared';
import { INCIDENT_STATUS_LABELS } from '@ticketing/shared';
import type { HttpFetch } from '../dev/providers';

export type AlertEvent = 'opened' | 'updated' | 'resolved';

export interface AlertIncident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  message: string;
  statusUrl: string;
}

const TIMEOUT_MS = 10_000;
const PAGERDUTY_URL = 'https://events.pagerduty.com/v2/enqueue';

const EVENT_LABELS: Record<AlertEvent, string> = {
  opened: 'Incident ouvert',
  updated: 'Mise à jour',
  resolved: 'Incident résolu',
};

function text(event: AlertEvent, i: AlertIncident) {
  return `[${i.severity}] ${EVENT_LABELS[event]} — ${i.title}\nStatut : ${INCIDENT_STATUS_LABELS[i.status]}\n${i.message}\n${i.statusUrl}`;
}

/**
 * Envoie l'alerte à une destination. Lève une erreur au message lisible en cas d'échec ;
 * l'appelant la journalise sans jamais bloquer l'incident.
 * PagerDuty ne reçoit que l'ouverture et la résolution (les mises à jour ne créent pas de page).
 */
export async function sendAlert(
  fetcher: HttpFetch,
  kind: AlertKindName,
  target: string,
  event: AlertEvent,
  incident: AlertIncident,
): Promise<'sent' | 'skipped'> {
  let url = target;
  let body: unknown;
  switch (kind) {
    case 'SLACK':
    case 'TEAMS':
      body = { text: text(event, incident) };
      break;
    case 'WEBHOOK':
      body = { event, incident };
      break;
    case 'PAGERDUTY':
      if (event === 'updated') return 'skipped';
      url = PAGERDUTY_URL;
      body = {
        routing_key: target,
        event_action: event === 'opened' ? 'trigger' : 'resolve',
        dedup_key: incident.id,
        payload: {
          summary: `[${incident.severity}] ${incident.title}`.slice(0, 1024),
          source: 'ticket-mango',
          severity: incident.severity === 'P0' ? 'critical' : 'error',
        },
        links: [{ href: incident.statusUrl, text: 'Status page' }],
      };
      break;
  }
  let res: Response;
  try {
    res = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error('Destination injoignable');
  }
  if (!res.ok) throw new Error(`Refusé par la destination (HTTP ${res.status})`);
  return 'sent';
}
