import type { Meeting, Prisma, PrismaClient } from '@prisma/client';
import { hasPermission, renderMacro, SYSTEM_MACRO_KEYS } from '@ticketing/shared';
import { randomBytes } from 'node:crypto';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import type { CurrentUser } from '../../plugins/auth';
import type { MacroService } from '../macros';
import type { TicketService } from '../tickets';
import type { MeetingProvider } from './provider';

const meetingInclude = {
  organizer: { select: { id: true, name: true, email: true } },
  attendees: { select: { user: { select: { id: true, name: true, email: true } } } },
  slots: { orderBy: { startsAt: 'asc' } },
  ticket: { select: { id: true, subject: true, requester: { select: { id: true, name: true, email: true } } } },
} satisfies Prisma.MeetingInclude;

type MeetingWithRelations = Prisma.MeetingGetPayload<{ include: typeof meetingInclude }>;

export interface CreateMeetingInput {
  mode: 'direct' | 'proposal';
  title?: string;
  durationMinutes: number;
  /** Mode direct : un seul créneau. Mode proposition : 2 à 5 créneaux. */
  slots: Date[];
  developerIds: string[];
}

export interface MeetingDeps {
  prisma: PrismaClient;
  tickets: TicketService;
  macros: MacroService;
  provider: MeetingProvider;
  publicAppUrl: string;
  timeZone: string;
}

const MAX_DAYS_AHEAD = 90;

export class MeetingService {
  constructor(private readonly d: MeetingDeps) {}

  private bookingUrl(token: string | null) {
    return token ? `${this.d.publicAppUrl.replace(/\/$/, '')}/book/${token}` : null;
  }

  private participants(m: MeetingWithRelations) {
    return [m.ticket.requester, ...m.attendees.map((a) => a.user), m.organizer];
  }

  private toDto(m: MeetingWithRelations) {
    return {
      id: m.id,
      ticketId: m.ticketId,
      title: m.title,
      durationMinutes: m.durationMinutes,
      status: m.status,
      startsAt: m.startsAt,
      meetUrl: m.meetUrl,
      provider: m.provider,
      bookingUrl: m.status === 'PROPOSED' ? this.bookingUrl(m.bookingToken) : null,
      slots: m.slots.map((s) => ({ id: s.id, startsAt: s.startsAt })),
      organizer: { id: m.organizer.id, name: m.organizer.name },
      participants: this.participants(m).map((p) => ({ id: p.id, name: p.name })),
      createdAt: m.createdAt,
    };
  }

  private event(m: MeetingWithRelations, startsAt: Date) {
    return {
      title: m.title,
      description: `Ticket #${m.ticket.id} : ${m.ticket.subject}`,
      startsAt,
      endsAt: new Date(startsAt.getTime() + m.durationMinutes * 60_000),
      organizerEmail: m.organizer.email,
      attendeeEmails: this.participants(m)
        .filter((p) => p.id !== m.organizer.id)
        .map((p) => p.email),
    };
  }

  async list(user: CurrentUser, ticketId: number) {
    await this.d.tickets.getVisible(user, ticketId);
    const meetings = await this.d.prisma.meeting.findMany({
      where: { ticketId },
      include: meetingInclude,
      orderBy: { createdAt: 'desc' },
    });
    return meetings.map((m) => this.toDto(m));
  }

  async create(user: CurrentUser, ticketId: number, input: CreateMeetingInput) {
    if (!hasPermission(user.role, 'meeting:create')) throw forbidden();
    const ticket = await this.d.tickets.getVisible(user, ticketId);
    if (ticket.status === 'CLOSED') throw conflict('Un ticket clôturé ne peut plus faire l’objet d’un rendez-vous');

    const slots = [...new Set(input.slots.map((s) => s.getTime()))].sort().map((t) => new Date(t));
    const now = Date.now();
    if (slots.some((s) => s.getTime() <= now)) throw badRequest('Les créneaux doivent être dans le futur');
    if (slots.some((s) => s.getTime() > now + MAX_DAYS_AHEAD * 86_400_000)) {
      throw badRequest(`Les créneaux doivent être dans les ${MAX_DAYS_AHEAD} prochains jours`);
    }
    if (input.mode === 'direct' && slots.length !== 1) throw badRequest('Un rendez-vous fixé a exactement un créneau');
    if (input.mode === 'proposal' && (slots.length < 2 || slots.length > 5)) {
      throw badRequest('Proposez entre 2 et 5 créneaux distincts');
    }
    const developerIds = [...new Set(input.developerIds)];
    const developers = await this.d.prisma.user.findMany({
      where: { id: { in: developerIds }, role: 'DEVELOPER', isActive: true },
    });
    if (developers.length !== developerIds.length) throw badRequest('Développeur inconnu ou inactif');

    const created = await this.d.prisma.meeting.create({
      data: {
        ticketId,
        organizerId: user.id,
        title: input.title?.trim() || `Ticket #${ticket.id} – ${ticket.subject}`,
        durationMinutes: input.durationMinutes,
        status: input.mode === 'direct' ? 'SCHEDULED' : 'PROPOSED',
        provider: this.d.provider.name,
        bookingToken: input.mode === 'proposal' ? randomBytes(24).toString('base64url') : null,
        slots: { create: slots.map((startsAt) => ({ startsAt })) },
        attendees: { create: developerIds.map((userId) => ({ userId })) },
      },
      include: meetingInclude,
    });

    let meeting: MeetingWithRelations = created;
    if (input.mode === 'direct') {
      try {
        meeting = await this.schedule(created, slots[0]!);
      } catch (err) {
        await this.d.prisma.meeting.delete({ where: { id: created.id } });
        throw err;
      }
    }
    await this.audit(ticketId, user.id, input.mode === 'direct' ? 'meeting.scheduled' : 'meeting.proposed', meeting);
    return this.toDto(meeting);
  }

  /** Crée l'événement chez le fournisseur et enregistre le lien. */
  private async schedule(m: MeetingWithRelations, startsAt: Date) {
    const { eventId, meetUrl } = await this.d.provider.createEvent(this.event(m, startsAt));
    return this.d.prisma.meeting.update({
      where: { id: m.id },
      data: { status: 'SCHEDULED', startsAt, meetUrl, providerEventId: eventId },
      include: meetingInclude,
    });
  }

  async cancel(user: CurrentUser, ticketId: number, meetingId: string) {
    if (!hasPermission(user.role, 'meeting:create')) throw forbidden();
    await this.d.tickets.getVisible(user, ticketId);
    const meeting = await this.d.prisma.meeting.findFirst({ where: { id: meetingId, ticketId }, include: meetingInclude });
    if (!meeting) throw notFound('Rendez-vous introuvable');
    if (meeting.status === 'CANCELLED') return this.toDto(meeting);
    if (meeting.providerEventId) await this.d.provider.cancelEvent(meeting.providerEventId, meeting.organizer.email);
    const updated = await this.d.prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'CANCELLED' },
      include: meetingInclude,
    });
    await this.audit(ticketId, user.id, 'meeting.cancelled', updated);
    return this.toDto(updated);
  }

  // Page publique de réservation : accessible par le seul jeton, sans session.

  private async byToken(token: string) {
    const meeting = await this.d.prisma.meeting.findUnique({ where: { bookingToken: token }, include: meetingInclude });
    if (!meeting) throw notFound('Lien de réservation invalide');
    return meeting;
  }

  /** Vue publique : aucune adresse email ni information interne. */
  private publicView(m: MeetingWithRelations) {
    const now = Date.now();
    return {
      status: m.status,
      title: m.title,
      ticket: { id: m.ticket.id, subject: m.ticket.subject },
      organizer: m.organizer.name,
      durationMinutes: m.durationMinutes,
      participants: this.participants(m).map((p) => p.name),
      slots: m.status === 'PROPOSED' ? m.slots.filter((s) => s.startsAt.getTime() > now).map((s) => ({ id: s.id, startsAt: s.startsAt })) : [],
      startsAt: m.startsAt,
      meetUrl: m.status === 'SCHEDULED' ? m.meetUrl : null,
      provider: m.provider,
    };
  }

  async getBooking(token: string) {
    return this.publicView(await this.byToken(token));
  }

  async book(token: string, slotId: string) {
    const meeting = await this.byToken(token);
    if (meeting.status !== 'PROPOSED') throw conflict('Ce rendez-vous n’est plus ouvert à la réservation');
    const slot = meeting.slots.find((s) => s.id === slotId);
    if (!slot || slot.startsAt.getTime() <= Date.now()) throw badRequest('Ce créneau n’est plus disponible');

    // Réservation exclusive : un seul choix l'emporte en cas de clics simultanés.
    const { count } = await this.d.prisma.meeting.updateMany({
      where: { id: meeting.id, status: 'PROPOSED' },
      data: { status: 'SCHEDULED', startsAt: slot.startsAt },
    });
    if (count === 0) throw conflict('Ce rendez-vous vient d’être réservé');

    let scheduled: MeetingWithRelations;
    try {
      scheduled = await this.schedule(meeting, slot.startsAt);
    } catch (err) {
      await this.d.prisma.meeting.update({ where: { id: meeting.id }, data: { status: 'PROPOSED', startsAt: null } });
      throw err;
    }
    await this.audit(meeting.ticketId, null, 'meeting.booked', scheduled);
    await this.postInvitation(scheduled);
    return this.publicView(scheduled);
  }

  /** Publie automatiquement l'invitation (macro système) sur le ticket, au nom de l'organisateur. */
  private async postInvitation(m: MeetingWithRelations) {
    const macro = await this.d.macros.bySystemKey(SYSTEM_MACRO_KEYS.meetingScheduled);
    if (!macro?.isActive) return;
    const body = renderMacro(macro.body, {
      ticket: m.ticket,
      requester: m.ticket.requester,
      agent: m.organizer,
      meeting: {
        url: m.meetUrl,
        startsAt: m.startsAt,
        durationMinutes: m.durationMinutes,
        participants: this.participants(m).map((p) => p.name),
      },
      timeZone: this.d.timeZone,
    });
    const organizer = await this.d.prisma.user.findUniqueOrThrow({ where: { id: m.organizerId } });
    if (!organizer.isActive) return;
    await this.d.tickets.addComment(
      { id: organizer.id, email: organizer.email, name: organizer.name, role: organizer.role },
      m.ticketId,
      body,
      macro.isInternal,
    );
  }

  private audit(ticketId: number, actorId: string | null, action: string, m: Meeting) {
    return this.d.prisma.auditLog.create({
      data: {
        ticketId,
        actorId,
        action,
        changes: { meetingId: m.id, status: m.status, startsAt: m.startsAt?.toISOString() ?? null, provider: m.provider },
      },
    });
  }
}
