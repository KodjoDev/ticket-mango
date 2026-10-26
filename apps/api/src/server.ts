import { PrismaClient } from '@prisma/client';
import { buildApp } from './app';
import { SmtpTransport } from './services/email/smtp';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const prisma = new PrismaClient();
  const app = await buildApp({
    config,
    prisma,
    mailTransport: config.SMTP_URL ? new SmtpTransport(config.SMTP_URL) : undefined,
    logger:
      config.NODE_ENV === 'development'
        ? { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } }
        : { level: config.LOG_LEVEL, redact: ['req.headers.authorization'] },
  });

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} reçu, arrêt en cours`);
    app.slaMonitor.stop();
    app.mailer.stop();
    app.imapPoller.stop();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.HOST, port: config.PORT });
  app.slaMonitor.start(60_000, (err) => app.log.error({ err }, 'Surveillance SLA en échec'));
  app.mailer.start(10_000, (err) => app.log.error({ err }, 'Envoi des e-mails en échec'));
  app.imapPoller.start(60_000, (err) => app.log.error({ err }, 'Relève IMAP en échec'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
