import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, type AppOverrides } from './app.module.js';
import type { AppConfig } from './config.js';

/** NFR-SEC-04: at most `limit` login attempts per IP per 15 minutes (the account lockout still applies). */
function loginLimiter(limit: number) {
  const windowMs = 15 * 60_000;
  const hits = new Map<string, { n: number; until: number }>();
  return (req: { ip?: string; method: string }, res: { status(c: number): { json(b: unknown): void }; setHeader(k: string, v: string): void }, next: () => void) => {
    if (req.method !== 'POST') return next();
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.until < now) hits.delete(k);
    const key = req.ip ?? 'unknown';
    const h = hits.get(key);
    if (!h || h.until < now) hits.set(key, { n: 1, until: now + windowMs });
    else if (++h.n > limit) {
      res.setHeader('retry-after', String(Math.ceil((h.until - now) / 1000)));
      return res.status(429).json({ statusCode: 429, message: 'Too many login attempts from this network. Try again in a few minutes.' });
    }
    next();
  };
}

export async function createApp(config: AppConfig, overrides: AppOverrides = {}, options: { quiet?: boolean } = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.create(config, overrides), options.quiet ? { logger: false } : {});
  app.setGlobalPrefix('api');
  // The client's IP comes from X-Forwarded-For: set by Caddy on the same machine, or by Vercel's edge
  app.set('trust proxy', process.env.VERCEL ? true : 'loopback');
  // A long multi-page bill's autosave is larger than Express's 100 KB default
  app.useBodyParser('json', { limit: '2mb' });
  app.use('/api/auth/login', loginLimiter(config.LOGIN_LIMIT_PER_IP));
  const web = isAbsolute(config.WEB_DIST) ? config.WEB_DIST : join(process.cwd(), config.WEB_DIST);
  if (existsSync(join(web, 'index.html')))
    app.useStaticAssets(web, {
      index: 'index.html',
      // Built files have content hashes in their names and never change; the entry files must be re-checked
      setHeaders: (res, path) =>
        res.setHeader('cache-control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    });
  app.enableShutdownHooks();
  return app;
}
