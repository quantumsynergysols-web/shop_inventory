import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().startsWith('postgresql://'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  /** Short-lived access token; the refresh token keeps the device signed in */
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60),
  /** FR-AUTH-01: session ends after 30 days without use */
  SESSION_IDLE_DAYS: z.coerce.number().int().positive().default(30),
  /** NFR-SEC-04: lockout after 5 failed logins */
  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  /** Bill photos and receipts (local disk in development; S3/R2 later) */
  STORAGE_DIR: z.string().default('storage'),
  /** "demo" until a real provider and key are configured (FR-AI-08, FR-AI-15) */
  AI_PROVIDER: z.enum(['demo']).default('demo'),
  /** Recorded AI results for known sample bills, used by the demo provider */
  DEMO_FIXTURES_DIR: z.string().default('demo-fixtures'),
  /** Built web app (apps/web/dist) served at / when present, so one port serves the PWA and the API */
  WEB_DIST: z.string().default('../web/dist'),
});

export type AppConfig = z.infer<typeof schema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration (see apps/api/.env.example): ${problems}`);
  }
  return parsed.data;
}
