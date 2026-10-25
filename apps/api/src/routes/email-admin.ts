import type { Prisma, PrismaClient } from '@prisma/client';
import { OPTION_KEY_PATTERN } from '@ticketing/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { notFound } from '../lib/errors';
import type { SecretBox } from '../lib/secrets';
import type { ImapPoller } from '../services/email/imap';
import { newWebhookToken, type InboundService } from '../services/email/inbound';

const idParams = z.object({ id: z.string().uuid() });

const mailboxSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    address: z.string().trim().toLowerCase().email(),
    isActive: z.boolean(),
    imapHost: z.string().trim().max(255).nullable(),
    imapPort: z.number().int().min(1).max(65_535).nullable(),
    imapSecure: z.boolean(),
    imapUser: z.string().trim().max(255).nullable(),
    /** Écriture seule : jamais renvoyé. Chaîne vide = inchangé. */
    imapPassword: z.string().max(500),
    imapFolder: z.string().trim().min(1).max(255),
    defaultType: z.string().regex(OPTION_KEY_PATTERN).nullable(),
    defaultGroupId: z.string().uuid().nullable(),
  })
  .partial()
  .strict();

const settingsSchema = z
  .object({
    acknowledge: z.boolean(),
    blocklist: z.array(z.string().trim().toLowerCase().regex(/^(@[a-z0-9.-]+\.[a-z]{2,}|[^@\s]+@[a-z0-9.-]+\.[a-z]{2,})$/, 'Adresse ou @domaine attendu')).max(500),
    maxPerSenderPerHour: z.number().int().min(1).max(1000),
  })
  .strict();

/** Boîte telle que renvoyée à l'interface : sans secret, avec l'URL du webhook. */
function mailboxDto(m: Prisma.MailboxGetPayload<object>, publicApiUrl: string) {
  const { imapPasswordEnc, webhookToken, uidValidity, ...rest } = m;
  return {
    ...rest,
    uidValidity: uidValidity?.toString() ?? null,
    hasPassword: !!imapPasswordEnc,
    webhookUrl: `${publicApiUrl.replace(/\/$/, '')}/inbound/email/${webhookToken}`,
  };
}

/** Administration de la messagerie (préfixe /admin) : boîtes, journal des réceptions, envois, réglages. */
export const emailAdminRoutes: FastifyPluginAsync<{
  prisma: PrismaClient;
  inbound: InboundService;
  poller: ImapPoller;
  secrets: SecretBox;
  publicApiUrl: string;
}> = async (app, { prisma, inbound, poller, secrets, publicApiUrl }) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('settings:manage'));

  const audit = (actorId: string, action: string, changes: Prisma.InputJsonValue) =>
    prisma.auditLog.create({ data: { actorId, action, changes } });

  app.get('/mailboxes', async () =>
    (await prisma.mailbox.findMany({ orderBy: { createdAt: 'asc' } })).map((m) => mailboxDto(m, publicApiUrl)),
  );

  app.post('/mailboxes', async (request, reply) => {
    const { imapPassword, ...data } = mailboxSchema.required({ name: true, address: true }).parse(request.body);
    const mailbox = await prisma.mailbox.create({
      data: { ...data, webhookToken: newWebhookToken(), ...(imapPassword && { imapPasswordEnc: secrets.encrypt(imapPassword) }) },
    });
    await audit(request.currentUser.id, 'admin.mailbox.created', { mailboxId: mailbox.id, address: mailbox.address });
    return reply.status(201).send(mailboxDto(mailbox, publicApiUrl));
  });

  app.patch('/mailboxes/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const { imapPassword, ...data } = mailboxSchema.parse(request.body);
    const mailbox = await prisma.mailbox.update({
      where: { id },
      data: {
        ...data,
        ...(imapPassword && { imapPasswordEnc: secrets.encrypt(imapPassword) }),
        // Nouveau serveur ou dossier : le curseur IMAP repart de zéro.
        ...((data.imapHost !== undefined || data.imapFolder !== undefined || data.imapUser !== undefined) && { uidValidity: null, lastUid: null }),
      },
    });
    await audit(request.currentUser.id, 'admin.mailbox.updated', {
      mailboxId: id,
      fields: Object.keys(request.body as object).map((k) => (k === 'imapPassword' ? 'imapPassword (modifié)' : k)),
    });
    return mailboxDto(mailbox, publicApiUrl);
  });

  app.post('/mailboxes/:id/regenerate-token', async (request) => {
    const { id } = idParams.parse(request.params);
    const mailbox = await prisma.mailbox.update({ where: { id }, data: { webhookToken: newWebhookToken() } });
    await audit(request.currentUser.id, 'admin.mailbox.token_regenerated', { mailboxId: id });
    return mailboxDto(mailbox, publicApiUrl);
  });

  app.post('/mailboxes/:id/test', async (request) => {
    const { id } = idParams.parse(request.params);
    const mailbox = await prisma.mailbox.findUnique({ where: { id } });
    if (!mailbox) throw notFound('Boîte introuvable');
    return poller.test(mailbox);
  });

  app.post('/mailboxes/:id/poll', async (request) => {
    const { id } = idParams.parse(request.params);
    const mailbox = await prisma.mailbox.findUnique({ where: { id } });
    if (!mailbox) throw notFound('Boîte introuvable');
    // Relève immédiate : on lève le bail pour ne pas attendre le prochain passage.
    await prisma.mailbox.update({ where: { id }, data: { lastCheckedAt: null } });
    return poller.pollMailbox({ ...mailbox, lastCheckedAt: null });
  });

  app.delete('/mailboxes/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await prisma.mailbox.delete({ where: { id } });
    await audit(request.currentUser.id, 'admin.mailbox.deleted', { mailboxId: id });
    return reply.status(204).send();
  });

  app.get('/inbound', async (request) => {
    const q = z
      .object({
        status: z.enum(['PROCESSED', 'DUPLICATE', 'AUTO_REPLY', 'SPAM', 'LOOP', 'ERROR']).optional(),
        page: z.coerce.number().int().min(1).default(1),
      })
      .parse(request.query);
    const where = q.status ? { status: q.status } : {};
    const [items, total] = await prisma.$transaction([
      prisma.inboundEmail.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (q.page - 1) * 50,
        take: 50,
        include: { mailbox: { select: { address: true } } },
      }),
      prisma.inboundEmail.count({ where }),
    ]);
    return { items: items.map(({ rawKey, ...i }) => ({ ...i, canRetry: !!rawKey })), total, page: q.page, pageSize: 50 };
  });

  app.post('/inbound/:id/retry', async (request) => {
    const { id } = idParams.parse(request.params);
    const result = await inbound.retry(id);
    await audit(request.currentUser.id, 'admin.inbound.retried', { inboundId: id, status: result.status });
    return result;
  });

  app.get('/outbound', async (request) => {
    const { status } = z.object({ status: z.enum(['PENDING', 'SENT', 'FAILED', 'SKIPPED']).optional() }).parse(request.query);
    return prisma.outboundEmail.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, ticketId: true, toAddress: true, subject: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true },
    });
  });

  app.post('/outbound/:id/retry', async (request) => {
    const { id } = idParams.parse(request.params);
    await prisma.outboundEmail.update({ where: { id }, data: { status: 'PENDING', nextAttemptAt: new Date(), attempts: 0 } });
    await audit(request.currentUser.id, 'admin.outbound.retried', { outboundId: id });
    return { ok: true };
  });

  app.get('/email-settings', async () => inbound.settings());

  app.put('/email-settings', async (request) => {
    const settings = settingsSchema.parse(request.body);
    await prisma.setting.upsert({
      where: { key: 'emailSettings' },
      create: { key: 'emailSettings', value: settings },
      update: { value: settings },
    });
    await audit(request.currentUser.id, 'admin.email_settings.updated', settings);
    return settings;
  });
};
