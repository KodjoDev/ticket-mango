import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Config } from './config';
import { authPlugin } from './plugins/auth';
import { registerErrorHandler } from './plugins/errors';
import { authRoutes } from './routes/auth';
import { ticketRoutes } from './routes/tickets';
import { userRoutes } from './routes/users';

export interface AppDeps {
  config: Pick<Config, 'JWT_SECRET' | 'JWT_EXPIRES_IN' | 'LOGIN_RATE_LIMIT'>;
  prisma: PrismaClient;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp({ config, prisma, logger = false }: AppDeps) {
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

  await app.register(authRoutes, { prefix: '/auth', prisma, loginRateLimit: config.LOGIN_RATE_LIMIT });
  await app.register(userRoutes, { prefix: '/users', prisma });
  await app.register(ticketRoutes, { prefix: '/tickets', prisma });

  return app;
}
