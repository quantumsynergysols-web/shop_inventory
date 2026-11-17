import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { createApp } from '../app.js';
import type { AppConfig } from '../config.js';
import { hashPassword } from './password.js';
import { Requires } from './decorators.js';
import { MemoryAuthStore } from '../test-support/memory-auth.store.js';

const config: AppConfig = {
  DATABASE_URL: 'postgresql://unused',
  JWT_SECRET: 'test-secret-that-is-long-enough-0123456789',
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

let app: INestApplication;
let base: string;
let store: MemoryAuthStore;
let clock = new Date('2026-11-17T09:00:00Z');
let dbUp = true;

async function call(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

before(async () => {
  store = new MemoryAuthStore();
  const hash = await hashPassword('owner-pass-1');
  store.addUser({ phone: '03001234567', name: 'Haji Sb', shopId: 'shop-1', role: 'OWNER', passwordHash: hash, active: true });
  store.addUser({ phone: '03007654321', name: 'Counter', shopId: 'shop-1', role: 'SALESMAN', passwordHash: await hashPassword('sales-pass-1'), active: true });
  store.addUser({ phone: '03000000000', name: 'Left', shopId: 'shop-1', role: 'SALESMAN', passwordHash: hash, active: false });

  // A route guarded by the permission matrix, only for this test
  @Controller('test-void')
  class VoidProbe {
    @Requires('document.void')
    @Get()
    ok() {
      return { ok: true };
    }
  }
  const { AppModule } = await import('../app.module.js');
  const original = AppModule.create;
  AppModule.create = (c, o) => {
    const m = original(c, o);
    return { ...m, controllers: [...(m.controllers ?? []), VoidProbe] };
  };
  app = await createApp(config, { authStore: store, health: { dbUp: async () => dbUp }, now: () => clock }, { quiet: true });
  AppModule.create = original;
  await app.listen(0);
  const addr = app.getHttpServer().address();
  base = `http://127.0.0.1:${addr.port}/api`;
});

after(async () => {
  await app.close();
});

beforeEach(() => {
  clock = new Date('2026-11-17T09:00:00Z');
  for (const u of store.users) {
    u.failedLogins = 0;
    u.lockedUntil = null;
  }
});

test('health is public and reports the database', async () => {
  dbUp = true;
  assert.deepEqual((await call('GET', '/health')).json, { status: 'ok', db: 'up' });
  dbUp = false;
  assert.deepEqual((await call('GET', '/health')).json, { status: 'degraded', db: 'down' });
  dbUp = true;
});

test('routes need a token', async () => {
  assert.equal((await call('GET', '/auth/me')).status, 401);
  assert.equal((await call('GET', '/auth/me', undefined, 'not-a-jwt')).status, 401);
});

test('login, me, refresh rotates the token, logout ends the session', async () => {
  const login = await call('POST', '/auth/login', { login: '03001234567', password: 'owner-pass-1' });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.role, 'OWNER');
  const me = await call('GET', '/auth/me', undefined, login.json.accessToken);
  assert.deepEqual(me.json, { userId: login.json.user.id, shopId: 'shop-1', role: 'OWNER' });

  const r1 = await call('POST', '/auth/refresh', { refreshToken: login.json.refreshToken });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.json.refreshToken, login.json.refreshToken);
  assert.equal((await call('POST', '/auth/refresh', { refreshToken: login.json.refreshToken })).status, 401, 'old refresh token is dead');

  assert.equal((await call('POST', '/auth/logout', { refreshToken: r1.json.refreshToken })).status, 204);
  assert.equal((await call('POST', '/auth/refresh', { refreshToken: r1.json.refreshToken })).status, 401);
});

test('session ends after 30 idle days, and refresh slides the expiry (FR-AUTH-01)', async () => {
  const login = await call('POST', '/auth/login', { login: '03001234567', password: 'owner-pass-1' });
  clock = new Date('2026-12-10T09:00:00Z'); // 23 days later
  const r = await call('POST', '/auth/refresh', { refreshToken: login.json.refreshToken });
  assert.equal(r.status, 200);
  clock = new Date('2027-01-05T09:00:00Z'); // 26 days after the refresh
  assert.equal((await call('POST', '/auth/refresh', { refreshToken: r.json.refreshToken })).status, 200);
  clock = new Date('2027-03-01T09:00:00Z');
  assert.equal((await call('POST', '/auth/refresh', { refreshToken: r.json.refreshToken })).status, 401);
});

test('wrong password, unknown user and disabled user get the same answer', async () => {
  const wrong = await call('POST', '/auth/login', { login: '03001234567', password: 'nope' });
  const unknown = await call('POST', '/auth/login', { login: '03111111111', password: 'nope' });
  const disabled = await call('POST', '/auth/login', { login: '03000000000', password: 'owner-pass-1' });
  assert.deepEqual([wrong.status, unknown.status, disabled.status], [401, 401, 401]);
  assert.equal(wrong.json.message, unknown.json.message);
  assert.equal(wrong.json.message, disabled.json.message);
});

test('5 wrong passwords lock the account for 15 minutes (NFR-SEC-04)', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/login', { login: '03007654321', password: 'bad' })).status, 401);
  assert.equal((await call('POST', '/auth/login', { login: '03007654321', password: 'sales-pass-1' })).status, 423, 'locked even with the right password');
  assert.ok(store.auditLog.some((a) => a.action === 'auth.locked'));
  clock = new Date(clock.getTime() + 16 * 60_000);
  assert.equal((await call('POST', '/auth/login', { login: '03007654321', password: 'sales-pass-1' })).status, 200);
});

test('permission matrix is enforced on routes (§3.11)', async () => {
  const owner = await call('POST', '/auth/login', { login: '03001234567', password: 'owner-pass-1' });
  const sales = await call('POST', '/auth/login', { login: '03007654321', password: 'sales-pass-1' });
  assert.equal((await call('GET', '/test-void', undefined, owner.json.accessToken)).status, 200);
  const denied = await call('GET', '/test-void', undefined, sales.json.accessToken);
  assert.equal(denied.status, 403);
});

test('bad request body gives 400 with the problems', async () => {
  const r = await call('POST', '/auth/login', { login: 'x' });
  assert.equal(r.status, 400);
  assert.ok(r.json.issues.length >= 1);
});
