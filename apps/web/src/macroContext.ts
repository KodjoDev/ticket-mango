import type { MacroContext } from '@ticketing/shared';
import type { Meeting, Ticket } from './api/types';

/** Rendez-vous de référence pour les variables {{meet.*}} : le plus récent non annulé. */
export function currentMeeting(meetings: Meeting[]): Meeting | undefined {
  return meetings.find((m) => m.status !== 'CANCELLED');
}

export function macroContext(ticket: Ticket, agentName: string, meeting?: Meeting): MacroContext {
  return {
    ticket: { id: ticket.id, subject: ticket.subject },
    requester: { name: ticket.requester.name },
    agent: { name: agentName },
    meeting: meeting && {
      url: meeting.meetUrl,
      startsAt: meeting.startsAt,
      durationMinutes: meeting.durationMinutes,
      participants: meeting.participants.map((p) => p.name),
      bookingUrl: meeting.bookingUrl,
      slots: meeting.slots.map((s) => s.startsAt),
    },
    // Les dates sont rédigées dans le fuseau de l'agent, avec son abréviation (ex. UTC+1).
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
