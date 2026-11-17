import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import type { AppConfig } from '../config.js';

/** Helpers for the *.db.test.ts integration tests. Not used in production. */
export interface Http {
  status: number;
  // eslint-style "any" on purpose: tests poke at JSON freely
  json: any;
  headers: Headers;
  bytes: Buffer;
}

export function testConfig(url: string): AppConfig {
  return {
    DATABASE_URL: url,
    JWT_SECRET: 'db-test-secret-that-is-long-enough-0123456789',
    PORT: 0,
    ACCESS_TOKEN_TTL_SECONDS: 3600,
    SESSION_IDLE_DAYS: 30,
    MAX_FAILED_LOGINS: 5,
    LOCKOUT_MINUTES: 15,
    STORAGE_DIR: join(tmpdir(), 'erp-test-storage'),
    AI_PROVIDER: 'demo',
    DEMO_FIXTURES_DIR: join(tmpdir(), 'erp-test-no-fixtures'),
    WEB_DIST: join(tmpdir(), 'erp-test-no-web'),
  };
}

export async function resetDb(db: PrismaClient): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
}

/** A shop with one user per role (password "test-pass-1"), a Walk-in customer and default expense heads. */
export async function makeShop(db: PrismaClient, name: string, phonePrefix: string, settings: object = {}) {
  const shop = await db.shop.create({
    data: { name, address: 'Hall Road, Lahore', phone: '042-1111111', settings, expenseHeads: { create: ['Tea / food', 'Labour', 'Transport'].map((n) => ({ name: n })) } },
  });
  const pw = await hashPassword('test-pass-1');
  const phones: Record<string, string> = {};
  for (const [i, role] of (['OWNER', 'SALESMAN', 'STOREKEEPER', 'ACCOUNTANT'] as const).entries()) {
    const phone = `${phonePrefix}${String(i).padStart(7, '0')}`;
    await db.user.create({ data: { shopId: shop.id, name: `${role.toLowerCase()} of ${name}`, phone, role, passwordHash: pw } });
    phones[role] = phone;
  }
  await db.party.create({ data: { shopId: shop.id, name: 'Walk-in', normalizedName: 'walk in', type: 'CUSTOMER' } });
  return { shop, phones };
}

export async function startApp(url: string): Promise<{ app: INestApplication; base: string }> {
  const app = await createApp(testConfig(url), {}, { quiet: true });
  await app.listen(0);
  return { app, base: `http://127.0.0.1:${app.getHttpServer().address().port}/api` };
}

export function client(base: string) {
  const tokens = new Map<string, string>();
  async function call(method: string, path: string, who: string | null, body?: unknown, headers: Record<string, string> = {}): Promise<Http> {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${tokens.get(who)}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    let json: unknown = null;
    try {
      json = bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
    } catch {
      json = bytes.toString('utf8');
    }
    return { status: res.status, json, headers: res.headers, bytes };
  }
  async function login(who: string, phone: string, password = 'test-pass-1') {
    const r = await call('POST', '/auth/login', null, { login: phone, password });
    if (r.status !== 200) throw new Error(`login ${who} failed: ${JSON.stringify(r.json)}`);
    tokens.set(who, r.json.accessToken);
  }
  return { call, login };
}
