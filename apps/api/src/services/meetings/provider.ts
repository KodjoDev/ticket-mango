import { randomBytes, randomUUID } from 'node:crypto';

export interface MeetingEventInput {
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  /** Agenda dans lequel l'événement est créé. */
  organizerEmail: string;
  attendeeEmails: string[];
}

export interface CreatedMeetingEvent {
  eventId: string;
  meetUrl: string;
}

/**
 * Fournisseur de visioconférence. L'implémentation Google Calendar (création d'un
 * événement avec conferenceData hangoutsMeet et envoi des invitations par Google)
 * sera branchée une fois le mode de connexion Google choisi.
 */
export interface MeetingProvider {
  readonly name: string;
  createEvent(input: MeetingEventInput): Promise<CreatedMeetingEvent>;
  cancelEvent(eventId: string, organizerEmail: string): Promise<void>;
}

/**
 * Mode démo : aucun appel externe, aucune invitation envoyée. Le lien généré utilise
 * le domaine réservé .invalid pour ne jamais être confondu avec un vrai Meet.
 */
export class DemoMeetingProvider implements MeetingProvider {
  readonly name = 'demo';

  async createEvent(): Promise<CreatedMeetingEvent> {
    const letters = 'abcdefghijkmnopqrstuvwxyz';
    const bytes = randomBytes(10);
    const code = [3, 4, 3]
      .map((len, i) => Array.from({ length: len }, (_, j) => letters[bytes[i * 3 + j]! % letters.length]).join(''))
      .join('-');
    return { eventId: `demo-${randomUUID()}`, meetUrl: `https://meet.demo.invalid/${code}` };
  }

  async cancelEvent(): Promise<void> {}
}
