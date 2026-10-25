import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Config } from './config';
import { authPlugin } from './plugins/auth';
import { registerErrorHandler } from './plugins/errors';
import { adminRoutes } from './routes/admin';
import { agentRoutes } from './routes/agents';
import { authRoutes } from './routes/auth';
import { configRoutes } from './routes/config';
import { macroAdminRoutes, macroRoutes } from './routes/macros';
import { bookingRoutes, developerRoutes, meetingRoutes } from './routes/meetings';
import { ticketRoutes } from './routes/tickets';
import { userRoutes } from './routes/users';
import { viewRoutes } from './routes/views';
import { ConfigService } from './services/config';
import { MacroService } from './services/macros';
import { DemoMeetingProvider, type MeetingProvider } from './services/meetings/provider';
import { MeetingService } from './services/meetings/service';
import { LanguageToolClient } from './services/spellcheck';
import { spellcheckRoutes } from './routes/spellcheck';
import { TicketService } from './services/tickets';

export interface AppDeps {
  config: Pick<Config, 'JWT_SECRET' | 'JWT_EXPIRES_IN' | 'LOGIN_RATE_LIMIT' | 'COOKIE_SECURE'> &
    Partial<Pick<Config, 'PUBLIC_APP_URL' | 'APP_TIMEZONE' | 'LANGUAGETOOL_URL'>>;
  /** Fournisseur de visioconférence ; mode démo par défaut. */
  meetingProvider?: MeetingProvider;
  /** Client du correcteur ; par défaut construit depuis LANGUAGETOOL_URL. */
  spellchecker?: LanguageToolClient | null;
  prisma: PrismaClient;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp({
  config,
  prisma,
  logger = false,
  meetingProvider = new DemoMeetingProvider(),
  spellchecker = config.LANGUAGETOOL_URL ? new LanguageToolClient(config.LANGUAGETOOL_URL) : null,
}: AppDeps) {
  const app = Fastify({ logger, trustProxy: true });

  registerErrorHandler(app);
  await app.register(sensible);
  await app.register(helmet);
  // Désactivé globalement, activé route par route (connexion).
  await app.register(rateLimit, { global: false });
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

  await app.register(authRoutes, { prefix: '/auth',
    prisma,
    loginRateLimit: config.LOGIN_RATE_LIMIT,
    cookieSecure: config.COOKIE_SECURE,
  });
  await app.register(userRoutes, { prefix: '/users', prisma });
  await app.register(agentRoutes, { prefix: '/agents', prisma });
  const configService = new ConfigService(prisma);
  await app.register(ticketRoutes, { prefix: '/tickets', prisma, config: configService });
  await app.register(configRoutes, {
    prefix: '/config',
    prisma,
    config: configService,
    features: { spellcheck: spellchecker !== null, meetingProvider: meetingProvider.name },
  });
  await app.register(viewRoutes, { prefix: '/views', prisma, config: configService });
  await app.register(adminRoutes, { prefix: '/admin', prisma, config: configService });

  const tickets = new TicketService(prisma, configService);
  const macros = new MacroService(prisma, configService, tickets);
  const meetings = new MeetingService({
    prisma,
    tickets,
    macros,
    provider: meetingProvider,
    publicAppUrl: config.PUBLIC_APP_URL ?? 'http://localhost:5173',
    timeZone: config.APP_TIMEZONE ?? 'Europe/Paris',
  });
  await app.register(meetingRoutes, { prefix: '/tickets', meetings });
  await app.register(developerRoutes, { prefix: '/developers', prisma });
  await app.register(bookingRoutes, { prefix: '/public/bookings', meetings });
  await app.register(macroRoutes, { prefix: '/macros', macros });
  await app.register(spellcheckRoutes, { prefix: '/spellcheck', client: spellchecker });
  await app.register(macroAdminRoutes, { prefix: '/admin/macros', prisma, macros });

  return app;
}
