import type { PrismaClient } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getDummyHash, verifyPassword } from '../lib/password';
import { SESSION_COOKIE } from '../plugins/auth';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(256),
});

export const authRoutes: FastifyPluginAsync<{
  prisma: PrismaClient;
  loginRateLimit: number;
  cookieSecure: boolean;
}> = async (
  app,
  { prisma, loginRateLimit, cookieSecure },
) => {
  app.post(
    '/login',
    { config: { rateLimit: { max: loginRateLimit, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { email, password } = loginSchema.parse(request.body);
      const user = await prisma.user.findUnique({ where: { email } });
      // On vérifie toujours un hash pour ne pas révéler l'existence du compte par le temps de réponse.
      const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
      if (!user || !user.isActive || !valid) {
        return reply.unauthorized('Identifiants invalides');
      }
      const token = await reply.jwtSign({ sub: user.id });
      // Cookie de session (sans date d'expiration) ; la durée de validité reste portée par le JWT.
      // SameSite=Strict empêche son envoi depuis un autre site (protection CSRF).
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: 'strict',
        path: '/',
      });
      return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
    },
  );

  app.post('/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/me', { preHandler: app.authenticate }, async (request) => request.currentUser);
};
