/**
 * Desktop first-run setup: creates the first shop and owner only while the database is empty.
 * Run with: npm run test:db --workspace @erp/api
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { client, resetDb, startApp } from '../test-support/db-app.js';

const url = process.env.TEST_DATABASE_URL;

describe('desktop first-run setup against PostgreSQL', { skip: !url && 'TEST_DATABASE_URL not set (run npm run test:db)' }, () => {
  let app: INestApplication;
  let off: INestApplication;
  let db: PrismaClient;
  let api: ReturnType<typeof client>;
  let offApi: ReturnType<typeof client>;

  before(async () => {
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    await resetDb(db);
    ({ app } = await startApp(url!, { SETUP_ENABLED: true }));
    ({ app: off } = await startApp(url!));
    api = client(`http://127.0.0.1:${app.getHttpServer().address().port}/api`);
    offApi = client(`http://127.0.0.1:${off.getHttpServer().address().port}/api`);
  });

  after(async () => {
    await app?.close();
    await off?.close();
    await db?.$disconnect();
  });

  const body = { shopName: 'Ali Traders', ownerName: 'Ali', phone: '03211234567', password: 'first-owner-pass' };

  test('off on servers: no setup screen, no endpoint', async () => {
    assert.deepEqual((await offApi.call('GET', '/setup', null)).json, { needed: false });
    assert.equal((await offApi.call('POST', '/setup', null, body)).status, 404);
  });

  test('the first run creates the shop and owner, who can then log in', async () => {
    assert.deepEqual((await api.call('GET', '/setup', null)).json, { needed: true });
    assert.equal((await api.call('POST', '/setup', null, { ...body, password: 'short' })).status, 400);
    // two clicks at once still make one shop
    const [a, b] = await Promise.all([api.call('POST', '/setup', null, body), api.call('POST', '/setup', null, { ...body, shopName: 'Second' })]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    assert.equal(await db.shop.count(), 1);
    assert.deepEqual((await api.call('GET', '/setup', null)).json, { needed: false });
    await api.login('owner', body.phone, body.password);
    const cats = (await api.call('GET', '/categories', 'owner')).json;
    assert.equal(cats.length, 6, 'preset categories');
    assert.equal((await api.call('GET', '/expense-heads', 'owner')).json.length, 7);
    assert.ok((await api.call('GET', '/parties', 'owner')).json.some((p: any) => p.name === 'Walk-in'));
  });

  test('once set up, setup is refused', async () => {
    assert.equal((await api.call('POST', '/setup', null, { ...body, phone: '03001112223' })).status, 409);
  });
});
