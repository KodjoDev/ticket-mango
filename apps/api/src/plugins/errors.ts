import { Prisma } from '@prisma/client';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | ZodError | Error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Données invalides',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return reply.conflict('Cette ressource existe déjà');
      if (error.code === 'P2025') return reply.notFound('Ressource introuvable');
    }
    const statusCode = (error as FastifyError).statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Erreur non gérée');
      return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Erreur interne' });
    }
    return reply.status(statusCode).send(error);
  });
}
