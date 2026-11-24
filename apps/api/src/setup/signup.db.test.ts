/**
 * Online sign-up with QSSols approval, and the admin page API.
 * Run with: npm run test:db --workspace @erp/api
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { client, makeShop, resetDb, startApp } from '../test-support/db-app.js';

const url = process.env.TEST_DATABASE_URL;
const ADMIN = 'admin-key-for-tests-admin-key-for-tests';

describe('online sign-up and approval against PostgreSQL', { skip: !url && 'TEST_DATABASE_URL not set (run npm run test:db)' }, () => {
  let app: INestApplication;
  let off: INestApplication;
  let db: PrismaClient;
  let api: ReturnType<typeof client>;
  let offApi: ReturnType<typeof client>;

  before(async () => {
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    await resetDb(db);
    await makeShop(db, 'Existing Shop', '0391');
    ({ app } = await startApp(url!, { SIGNUP_ENABLED: true, PLATFORM_ADMIN_KEY: ADMIN, SIGNUP_TRIAL_SCANS: 20, HOSTED_MONTHLY_SCANS: 300 }));
    ({ app: off } = await startApp(url!));
    api = client(`http://127.0.0.1:${app.getHttpServer().address().port}/api`);
    offApi = client(`http://127.0.0.1:${off.getHttpServer().address().port}/api`);
  });

  after(async () => {
    await app?.close();
    await off?.close();
    await db?.$disconnect();
  });

  const shopA = { shopName: 'Ali Traders', ownerName: 'Ali', phone: '03211112222', password: 'ali-traders-pass', city: 'Lahore' };
  const shopB = { shopName: 'Spam Shop', ownerName: 'X', phone: '03213334444', password: 'spam-shop-pass' };
  const admin = { 'x-admin-key': ADMIN };

  test('off unless switched on; admin page off without a key', async () => {
    assert.deepEqual((await offApi.call('GET', '/signup', null)).json, { enabled: false });
    assert.equal((await offApi.call('POST', '/signup', null, shopA)).status, 404);
    assert.equal((await offApi.call('GET', '/admin/shops', null, undefined, admin)).status, 401);
  });

  test('a new shop waits for approval; the login says so', async () => {
    assert.deepEqual((await api.call('GET', '/signup', null)).json, { enabled: true });
    assert.equal((await api.call('POST', '/signup', null, { ...shopA, password: 'short' })).status, 400);
    const r = await api.call('POST', '/signup', null, shopA);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal((await api.call('POST', '/signup', null, { ...shopB, phone: shopA.phone })).status, 409, 'phone already used');
    assert.equal((await api.call('POST', '/signup', null, shopB)).status, 201);
    const login = await api.call('POST', '/auth/login', null, { login: shopA.phone, password: shopA.password });
    assert.equal(login.status, 403);
    assert.equal(login.json.code, 'SHOP_PENDING');
    assert.equal((await api.call('POST', '/auth/login', null, { login: shopA.phone, password: 'wrong-password' })).status, 401, 'a wrong password still says wrong password');
  });

  test('QSSols approves one and rejects the other', async () => {
    assert.equal((await api.call('GET', '/admin/shops', null, undefined, { 'x-admin-key': 'wrong-key' })).status, 401);
    const list = (await api.call('GET', '/admin/shops', null, undefined, admin)).json;
    const a = list.find((s: any) => s.name === 'Ali Traders');
    const b = list.find((s: any) => s.name === 'Spam Shop');
    assert.equal(a.status, 'PENDING');
    assert.equal(a.owner.phone, shopA.phone);
    assert.equal(a.signup.city, 'Lahore');
    assert.equal(a.monthlyScanQuota, 20, 'trial scans');
    assert.equal(list.find((s: any) => s.name === 'Existing Shop').status, 'ACTIVE');

    assert.equal((await api.call('POST', `/admin/shops/${a.id}/approve`, null, undefined, admin)).status, 201);
    assert.equal((await api.call('POST', `/admin/shops/${b.id}/reject`, null, undefined, admin)).status, 201);
    await api.login('ali', shopA.phone, shopA.password);
    const ai = (await api.call('GET', '/settings/ai', 'ali')).json;
    assert.equal(ai.usage.quota, 20);
    assert.equal((await api.call('GET', '/categories', 'ali')).json.length, 6, 'a ready shop with preset categories');
    const rej = await api.call('POST', '/auth/login', null, { login: shopB.phone, password: shopB.password });
    assert.deepEqual([rej.status, rej.json.code], [403, 'SHOP_REJECTED']);

    assert.equal((await api.call('PATCH', `/admin/shops/${a.id}/quota`, null, { monthlyScanQuota: 150 }, admin)).status, 200);
    assert.equal((await api.call('GET', '/settings/ai', 'ali')).json.usage.quota, 150);
    assert.ok(await db.auditLog.findFirst({ where: { action: 'signup.approve' } }));
  });
});
