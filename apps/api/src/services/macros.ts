import type { PrismaClient } from '@prisma/client';
import { canTransition, hasPermission, type MacroActions } from '@ticketing/shared';
import { conflict, forbidden, notFound } from '../lib/errors';
import type { CurrentUser } from '../plugins/auth';
import type { ConfigService } from './config';
import type { TicketService } from './tickets';

export class MacroService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: ConfigService,
    private readonly tickets: TicketService,
  ) {}

  list(includeInactive: boolean) {
    return this.prisma.macro.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { position: 'asc' },
    });
  }

  bySystemKey(systemKey: string) {
    return this.prisma.macro.findUnique({ where: { systemKey } });
  }

  /**
   * Applique une macro : publie le message (éventuellement retouché par l'agent) puis
   * exécute ses actions. Tout est vérifié avant la première écriture, pour qu'une
   * action impossible (transition interdite, droit manquant) n'aboutisse pas à moitié.
   */
  async apply(user: CurrentUser, ticketId: number, macroId: string, body: string) {
    const macro = await this.prisma.macro.findUnique({ where: { id: macroId } });
    if (!macro || !macro.isActive) throw notFound('Macro introuvable');
    const actions = macro.actions as MacroActions;
    const ticket = await this.tickets.getVisible(user, ticketId);

    const need = (ok: boolean) => {
      if (!ok) throw forbidden('Cette macro contient une action que votre rôle ne permet pas');
    };
    need(hasPermission(user.role, macro.isInternal ? 'comment:internal' : 'comment:public'));
    if (actions.status) {
      need(hasPermission(user.role, 'ticket:transition'));
      if (actions.status !== ticket.status && !canTransition(ticket.status, actions.status)) {
        throw conflict(`La macro passe le ticket en ${actions.status}, transition impossible depuis ${ticket.status}`);
      }
    }
    if (actions.addTagIds?.length) need(hasPermission(user.role, 'ticket:qualify'));
    if (actions.assignToMe) need(hasPermission(user.role, 'ticket:assign') && hasPermission(user.role, 'ticket:transition'));
    const tagIds = [...new Set([...ticket.tags.map((t) => t.id), ...(actions.addTagIds ?? [])])];
    if (actions.addTagIds?.length) await this.config.assertTagsUsable(tagIds, ticket.tags.map((t) => t.id));

    const comment = await this.tickets.addComment(user, ticketId, body, macro.isInternal);
    const update = {
      ...(actions.addTagIds?.length && { tagIds }),
      ...(actions.assignToMe && ticket.assignee?.id !== user.id && { assigneeId: user.id }),
    };
    if (Object.keys(update).length) await this.tickets.update(user, ticketId, update);
    if (actions.status && actions.status !== ticket.status) await this.tickets.transition(user, ticketId, actions.status);

    await this.prisma.auditLog.create({
      data: { ticketId, actorId: user.id, action: 'macro.applied', changes: { macro: macro.name, actions: { ...actions } } },
    });
    return { comment, ticket: await this.tickets.getVisible(user, ticketId) };
  }
}
