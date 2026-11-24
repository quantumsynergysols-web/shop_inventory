import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().startsWith('postgresql://'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  /** 127.0.0.1 in production behind Caddy; 0.0.0.0 lets phones on the same Wi-Fi reach a dev machine */
  HOST: z.string().default('0.0.0.0'),
  /** NFR-SEC-04: login attempts per IP address in 15 minutes (on top of the per-account lockout) */
  LOGIN_LIMIT_PER_IP: z.coerce.number().int().min(1).default(30),
  /** Short-lived access token; the refresh token keeps the device signed in */
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60),
  /** FR-AUTH-01: session ends after 30 days without use */
  SESSION_IDLE_DAYS: z.coerce.number().int().positive().default(30),
  /** NFR-SEC-04: lockout after 5 failed logins */
  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  /** Bill photos and receipts (local disk in development; S3/R2 later) */
  STORAGE_DIR: z.string().default('storage'),
  /** "blob" = Vercel Blob (serverless hosting); "disk" = STORAGE_DIR */
  /** Desktop app: first-run setup screen creates the shop while the database is empty */
  SETUP_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  STORAGE_DRIVER: z.enum(['disk', 'blob']).default('disk'),
  BLOB_READ_WRITE_TOKEN: z.string().default(''),
  /** Vercel Cron calls /api/cron/daily with this as a Bearer token; empty = the endpoint is off */
  CRON_SECRET: z.string().default(''),
  /** Kept for older .env files; the reader is chosen per shop in AI settings (FR-SET-02) */
  AI_PROVIDER: z.enum(['demo']).default('demo'),
  /** FR-AI-15: the QSSols-hosted reader shops use by default; "none" = demo/manual until a key is set */
  HOSTED_AI_PROVIDER: z.enum(['none', 'openai', 'gemini']).default('none'),
  OPENAI_API_KEY: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  /** Overridable for proxies and tests */
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta'),
  /** FR-AI-09: price per million tokens in US dollars, to log each call's cost; check the provider's price list */
  OPENAI_PRICE_IN_PER_MTOK: z.coerce.number().min(0).default(0.4),
  OPENAI_PRICE_OUT_PER_MTOK: z.coerce.number().min(0).default(1.6),
  GEMINI_PRICE_IN_PER_MTOK: z.coerce.number().min(0).default(0.3),
  GEMINI_PRICE_OUT_PER_MTOK: z.coerce.number().min(0).default(2.5),
  /** FR-AI-10/15: scans per shop per month on the hosted key (a shop's own quota setting overrides it) */
  HOSTED_MONTHLY_SCANS: z.coerce.number().int().min(0).default(300),
  /** FR-AI-06/07: an AI call longer than this fails and the scan offers retry */
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(90_000),
  /** NFR-SEC-01: encrypts shops' own AI keys (AES-256-GCM); at least 32 characters. Empty = own keys cannot be saved */
  AI_KEY_SECRET: z.union([z.literal(''), z.string().min(32, 'AI_KEY_SECRET must be at least 32 characters')]).default(''),
  /** Recorded AI results for known sample bills, used by the demo provider */
  DEMO_FIXTURES_DIR: z.string().default('demo-fixtures'),
  /** Built web app (apps/web/dist) served at / when present, so one port serves the PWA and the API */
  WEB_DIST: z.string().default('../web/dist'),
  /** FR-SET-05: daily pg_dump backup (all shops) */
  BACKUP_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  BACKUP_DIR: z.string().default('backups'),
  BACKUP_KEEP: z.coerce.number().int().min(1).max(365).default(14),
  /** Hour of the day, Pakistan time */
  BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(2),
  /** Path to pg_dump; empty = PATH, or the PostgreSQL install folder on Windows */
  PG_DUMP: z.string().default(''),
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
