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
