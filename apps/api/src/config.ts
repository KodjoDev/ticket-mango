import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET doit contenir au moins 32 caractères'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  /** Tentatives de connexion autorisées par minute et par adresse IP. */
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  /** URL publique de l'interface, utilisée dans les liens envoyés (page de réservation). */
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  /** Fuseau horaire des messages générés par le serveur (dates de rendez-vous). */
  APP_TIMEZONE: z.string().default('Europe/Paris'),
  /** Fournisseur de visioconférence : « demo » tant que Google n'est pas configuré. */
  MEETING_PROVIDER: z.enum(['demo']).default('demo'),
  /** Serveur LanguageTool auto-hébergé ; sans valeur, la correction grammaticale est désactivée. */
  LANGUAGETOOL_URL: z.string().url().optional(),
  /** URL publique de l'API (webhooks de réception) ; par défaut PUBLIC_APP_URL + /api. */
  PUBLIC_API_URL: z.string().url().optional(),
  /** Clé de chiffrement des secrets stockés (32 octets en base64 : openssl rand -base64 32). */
  SECRET_KEY: z.string().optional(),
  /** Envoi SMTP, ex. smtp://utilisateur:motdepasse@smtp.exemple.fr:587 ; sans valeur, les e-mails sont journalisés. */
  SMTP_URL: z.string().url().optional(),
  /** Adresse d'expédition à défaut de boîte de réception configurée. */
  EMAIL_FROM: z.string().email().optional(),
  EMAIL_FROM_NAME: z.string().default('Support'),
  /** Domaine des Message-ID ; par défaut celui de PUBLIC_APP_URL. */
  EMAIL_DOMAIN: z.string().optional(),
  /** Dossier des pièces jointes (stockage local). */
  STORAGE_DIR: z.string().default('./data'),
  /** Cookie de session réservé à HTTPS. Activé par défaut en production. */
  COOKIE_SECURE: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
});

export type Config = Omit<z.infer<typeof configSchema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Configuration invalide : ${details}`);
  }
  const { COOKIE_SECURE, ...config } = result.data;
  return { ...config, COOKIE_SECURE: COOKIE_SECURE ?? config.NODE_ENV === 'production' };
}
