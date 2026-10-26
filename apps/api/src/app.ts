import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Config } from './config';
import { SecretBox } from './lib/secrets';
import { authPlugin } from './plugins/auth';
import { registerErrorHandler } from './plugins/errors';
import { adminRoutes } from './routes/admin';
import { agentRoutes, requesterRoutes } from './routes/agents';
import { devAdminRoutes, devRoutes, devWebhookRoutes } from './routes/dev';
import { DevService } from './services/dev/service';
import type { HttpFetch } from './services/dev/providers';
import { alertAdminRoutes, incidentRoutes, publicStatusRoutes } from './routes/incidents';
import { IncidentService } from './services/incidents/service';
import { publicReleaseRoutes, releaseRoutes } from './routes/releases';
import { ReleaseService } from './services/releases';
import { privacyRoutes, reportRoutes } from './routes/privacy-reports';
import { PrivacyService } from './services/privacy';
import { customFieldAdminRoutes } from './routes/custom-fields-admin';
import { attachmentRoutes } from './routes/attachments';
import { authRoutes } from './routes/auth';
import { configRoutes } from './routes/config';
import { emailAdminRoutes } from './routes/email-admin';
import { inboundRoutes } from './routes/inbound';
import { macroAdminRoutes, macroRoutes } from './routes/macros';
import { bookingRoutes, developerRoutes, meetingRoutes } from './routes/meetings';
import { notificationRoutes } from './routes/notifications';
import { routingAdminRoutes } from './routes/routing-admin';
import { spellcheckRoutes } from './routes/spellcheck';
import { ticketRoutes } from './routes/tickets';
import { userRoutes } from './routes/users';
import { viewRoutes } from './routes/views';
import { AttachmentService, MAX_ATTACHMENT_BYTES } from './services/attachments';
import { ConfigService } from './services/config';
import { ImapPoller, imapflowConnector, type ImapConnector } from './services/email/imap';
import { InboundService, MAX_RAW_EMAIL_BYTES } from './services/email/inbound';
import { OutboundMailer, type MailTransport } from './services/email/outbound';
import { LogTransport } from './services/email/smtp';
import { MacroService } from './services/macros';
import { DemoMeetingProvider, type MeetingProvider } from './services/meetings/provider';
import { MeetingService } from './services/meetings/service';
import { NotificationService } from './services/notifications';
import { RoutingService } from './services/routing';
import { SlaService } from './services/sla';
import { SlaMonitor } from './services/sla-monitor';
import { LanguageToolClient } from './services/spellcheck';
import { LocalFileStorage, type FileStorage } from './services/storage';
import { TicketService } from './services/tickets';

declare module 'fastify' {
  interface FastifyInstance {
    /** Tâches de fond : démarrées par le serveur, appelées directement par les tests. */
    slaMonitor: SlaMonitor;
    mailer: OutboundMailer;
    imapPoller: ImapPoller;
    inbound: InboundService;
  }
}

export interface AppDeps {
  config: Pick<Config, 'JWT_SECRET' | 'JWT_EXPIRES_IN' | 'LOGIN_RATE_LIMIT' | 'COOKIE_SECURE'> &
    Partial<
      Pick<
        Config,
        | 'PUBLIC_APP_URL'
        | 'PUBLIC_API_URL'
        | 'APP_TIMEZONE'
        | 'LANGUAGETOOL_URL'
        | 'SECRET_KEY'
        | 'EMAIL_FROM'
        | 'EMAIL_FROM_NAME'
        | 'EMAIL_DOMAIN'
        | 'STORAGE_DIR'
      >
    >;
  prisma: PrismaClient;
  logger?: FastifyServerOptions['logger'];
  /** Fournisseur de visioconférence ; mode démo par défaut. */
  meetingProvider?: MeetingProvider;
  /** Client du correcteur ; par défaut construit depuis LANGUAGETOOL_URL. */
  spellchecker?: LanguageToolClient | null;
  /** Stockage des fichiers ; disque local (STORAGE_DIR) par défaut. */
  storage?: FileStorage;
  /** Transport d'envoi des e-mails ; journalisation seule si aucun n'est fourni. */
  mailTransport?: MailTransport;
  imapConnector?: ImapConnector;
  /** Client HTTP des appels sortants (Jira, GitHub, alertes d'incident) ; fetch par défaut. */
  devFetch?: HttpFetch;
}

export async function buildApp({
  config,
  prisma,
  logger = false,
  meetingProvider = new DemoMeetingProvider(),
  spellchecker = config.LANGUAGETOOL_URL ? new LanguageToolClient(config.LANGUAGETOOL_URL) : null,
  storage = new LocalFileStorage(config.STORAGE_DIR ?? './data'),
  mailTransport,
  imapConnector = imapflowConnector,
  devFetch = (url, init) => fetch(url, init),
}: AppDeps) {
  const app = Fastify({ logger, trustProxy: true });
  const publicAppUrl = config.PUBLIC_APP_URL ?? 'http://localhost:5173';

  registerErrorHandler(app);
  await app.register(sensible);
  await app.register(helmet);
  // Désactivé globalement, activé route par route (connexion, réception d'e-mails…).
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 10, fields: 20, fieldSize: MAX_RAW_EMAIL_BYTES },
  });
  await app.register(authPlugin, {
    prisma,
    secret: config.JWT_SECRET,
    expiresIn: config.JWT_EXPIRES_IN,
  });

  app.get('/health', async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (err) {
      request.log.error({ err }, 'Base de données injoignable');
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  await app.register(authRoutes, {
    prefix: '/auth',
    prisma,
    loginRateLimit: config.LOGIN_RATE_LIMIT,
    cookieSecure: config.COOKIE_SECURE,
  });
  await app.register(userRoutes, { prefix: '/users', prisma });
  await app.register(agentRoutes, { prefix: '/agents', prisma });
  await app.register(requesterRoutes, { prefix: '/requesters', prisma });

  const configService = new ConfigService(prisma);
  await app.register(configRoutes, {
    prefix: '/config',
    prisma,
    config: configService,
    features: { spellcheck: spellchecker !== null, meetingProvider: meetingProvider.name },
  });
  await app.register(adminRoutes, { prefix: '/admin', prisma, config: configService });

  // Services métier
  const notifications = new NotificationService(prisma);
  const sla = new SlaService(prisma, configService);
  const attachments = new AttachmentService(prisma, storage);
  const mailer = new OutboundMailer({
    prisma,
    attachments,
    transport: mailTransport ?? new LogTransport((msg) => app.log.info(msg)),
    defaultFrom: config.EMAIL_FROM ?? null,
    fromName: config.EMAIL_FROM_NAME ?? 'Support',
    domain: config.EMAIL_DOMAIN ?? new URL(publicAppUrl).hostname,
    publicAppUrl,
  });
  const tickets = new TicketService({
    prisma,
    config: configService,
    sla,
    routing: new RoutingService(prisma),
    notifications,
    attachments,
    mailer,
  });
  const secrets = new SecretBox(config.SECRET_KEY, config.JWT_SECRET);
  const inbound = new InboundService({ prisma, tickets, mailer, config: configService, storage });
  const imapPoller = new ImapPoller(prisma, inbound, secrets, imapConnector);
  const dev = new DevService({ prisma, tickets, secrets, publicAppUrl, fetcher: devFetch });
  const incidents = new IncidentService({ prisma, notifications, mailer, secrets, fetcher: devFetch, publicAppUrl });
  const releases = new ReleaseService({ prisma, mailer, publicAppUrl });
  const macros = new MacroService(prisma, configService, tickets);
  const meetings = new MeetingService({
    prisma,
    tickets,
    macros,
    provider: meetingProvider,
    publicAppUrl,
    timeZone: config.APP_TIMEZONE ?? 'Europe/Paris',
  });
  app.decorate('slaMonitor', new SlaMonitor(prisma, sla, notifications));
  app.decorate('mailer', mailer);
  app.decorate('imapPoller', imapPoller);
  app.decorate('inbound', inbound);

  // Tickets et support
  await app.register(ticketRoutes, { prefix: '/tickets', tickets });
  await app.register(meetingRoutes, { prefix: '/tickets', meetings });
  await app.register(attachmentRoutes, { prefix: '/attachments', attachments });
  await app.register(viewRoutes, { prefix: '/views', prisma, tickets });
  await app.register(notificationRoutes, { prefix: '/notifications', notifications });
  await app.register(developerRoutes, { prefix: '/developers', prisma });
  await app.register(macroRoutes, { prefix: '/macros', macros });
  await app.register(devRoutes, { prefix: '/dev', dev });
  await app.register(reportRoutes, { prefix: '/reports', prisma });
  await app.register(releaseRoutes, { prefix: '/releases', releases });
  await app.register(incidentRoutes, { prefix: '/incidents', incidents });
  await app.register(spellcheckRoutes, { prefix: '/spellcheck', client: spellchecker });

  // Accès publics (jeton secret dans l'URL)
  await app.register(bookingRoutes, { prefix: '/public/bookings', meetings });
  await app.register(publicReleaseRoutes, { prefix: '/public/releases', releases });
  await app.register(publicStatusRoutes, { prefix: '/public/status', incidents });
  await app.register(inboundRoutes, { prefix: '/inbound', prisma, inbound });
  await app.register(devWebhookRoutes, { prefix: '/inbound', prisma, dev });

  // Administration
  await app.register(routingAdminRoutes, { prefix: '/admin', prisma, config: configService });
  await app.register(macroAdminRoutes, { prefix: '/admin/macros', prisma, macros });
  const publicApiUrl = config.PUBLIC_API_URL ?? `${publicAppUrl.replace(/\/$/, '')}/api`;
  await app.register(devAdminRoutes, { prefix: '/admin', prisma, secrets, publicApiUrl });
  await app.register(customFieldAdminRoutes, { prefix: '/admin', prisma });
  await app.register(privacyRoutes, { prefix: '/admin/privacy', privacy: new PrivacyService(prisma, storage) });
  await app.register(alertAdminRoutes, { prefix: '/admin', prisma, secrets });
  await app.register(emailAdminRoutes, {
    prefix: '/admin',
    prisma,
    inbound,
    poller: imapPoller,
    secrets,
    publicApiUrl,
  });

  return app;
}
