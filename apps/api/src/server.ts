import { PrismaClient } from '@prisma/client';
import { buildApp } from './app';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const prisma = new PrismaClient();
  const app = await buildApp({
    config,
    prisma,
    logger:
      config.NODE_ENV === 'development'
        ? { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } }
        : { level: config.LOG_LEVEL, redact: ['req.headers.authorization'] },
  });

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} reçu, arrêt en cours`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
