import fastifyJwt from '@fastify/jwt';
import type { PrismaClient } from '@prisma/client';
import { hasPermission, type Permission, type Role } from '@ticketing/shared';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: CurrentUser;
  }
  interface FastifyInstance {
    authenticate: preHandlerAsyncHookHandler;
    requirePermission: (permission: Permission) => preHandlerAsyncHookHandler;
  }
}

interface AuthOptions {
  prisma: PrismaClient;
  secret: string;
  expiresIn: string;
}

export const authPlugin = fp<AuthOptions>(async (app, { prisma, secret, expiresIn }) => {
  await app.register(fastifyJwt, { secret, sign: { expiresIn } });

  app.decorateRequest('currentUser', null as unknown as CurrentUser);

  // L'utilisateur est relu à chaque requête : une désactivation ou un changement
  // de rôle prend effet immédiatement, sans attendre l'expiration du jeton.
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    let sub: string;
    try {
      ({ sub } = await request.jwtVerify<{ sub: string }>());
    } catch {
      return reply.unauthorized('Authentification requise');
    }
    const user = await prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) return reply.unauthorized('Authentification requise');
    request.currentUser = { id: user.id, email: user.email, name: user.name, role: user.role };
  });

  app.decorate('requirePermission', (permission: Permission) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!hasPermission(request.currentUser.role, permission)) {
        return reply.forbidden('Permission insuffisante');
      }
    };
  });
});
