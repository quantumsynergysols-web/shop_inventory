/**
 * AI settings and real reading end to end (FR-SET-02, FR-AI-01/09/10/15/16) with a fake AI server.
 * Run with: npm run test:db --workspace @erp/api
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { bill, startFakeAi } from '../../test-support/fake-ai.js';
import { client, makeShop, resetDb, startApp } from '../../test-support/db-app.js';
import { ScansService } from '../scans.service.js';

const url = process.env.TEST_DATABASE_URL;

describe('AI reading and settings against PostgreSQL', { skip: !url && 'TEST_DATABASE_URL not set (run npm run test:db)' }, () => {
  let app: INestApplication;
  let db: PrismaClient;
  let api: ReturnType<typeof client>;
  let fake: Awaited<ReturnType<typeof startFakeAi>>;
  const id: Record<string, string> = {};
  let n = 0;
  // a different photo every time, so duplicate-photo checks stay out of the way
  const photo = async () => sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 255, g: 255, b: (n += 7) % 255 } } }).png().toBuffer();

  before(async () => {
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    await resetDb(db);
    const a = await makeShop(db, 'Haji Sanitary', '0380');
    id.shop = a.shop.id;
    fake = await startFakeAi();
    ({ app } = await startApp(url!, {
      HOSTED_AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-hosted-test-0000000000',
      OPENAI_BASE_URL: fake.base,
      GEMINI_BASE_URL: fake.base,
      HOSTED_MONTHLY_SCANS: 1,
      AI_TIMEOUT_MS: 3000,
      AI_KEY_SECRET: 'k'.repeat(40),
    }));
    api = client(`http://127.0.0.1:${app.getHttpServer().address().port}/api`);
    await api.login('owner', a.phones.OWNER!);
    await api.login('store', a.phones.STOREKEEPER!);
    await api.call('POST', '/products', 'owner', { name: 'PVC Pipe 1 inch', purchasePricePaisa: 45000, salePricePaisa: 65000 });
  });

  after(async () => {
    await app?.close();
    await fake?.close();
    await db?.$disconnect();
  });

  async function scan(): Promise<any> {
    const up = await api.upload('/scans', 'store', 'pages', await photo(), 'bill.png', { type: 'PURCHASE' });
    assert.equal(up.status, 201, JSON.stringify(up.json));
    await app.get(ScansService).running.get(up.json.id);
    return (await api.call('GET', `/scans/${up.json.id}`, 'store')).json;
  }
  const reading = bill([{ n: 1, name: 'PVC pipe 1 inch', qty: 10, rate: 450, total: 4500 }, { n: 2, name: 'Gate valve', qty: 2, rate: 900, total: 1800 }], 6300, 'Al-Madina');

  test('settings: owner only, hosted by default, usage shown', async () => {
    assert.equal((await api.call('GET', '/settings/ai', 'store')).status, 403);
    const s = (await api.call('GET', '/settings/ai', 'owner')).json;
    assert.equal(s.mode, 'hosted');
    assert.equal(s.hostedAvailable, true);
    assert.equal(s.consentAt, null);
    assert.deepEqual(s.usage, { mode: 'hosted', usedThisMonth: 0, quota: 1, costThisMonthMicroUsd: 0 });
  });

  test('no photo goes to the AI before the owner agrees (FR-AI-16)', async () => {
    fake.calls.length = 0;
    const s = await scan();
    assert.equal(fake.calls.length, 0);
    assert.equal(s.aiReads, false);
    assert.ok(s.flags.includes('AI_NO_CONSENT'));
    assert.equal(s.lines.length, 0, 'manual mode: the photo with empty rows');
  });

  test('with consent the hosted AI reads the bill, cost is logged, the monthly limit applies (FR-AI-01/09/10/15)', async () => {
    assert.equal((await api.call('POST', '/settings/ai/consent', 'owner', { agree: true })).status, 201);
    fake.answer([{ bill: reading }]);
    const s = await scan();
    assert.equal(s.aiReads, true, JSON.stringify(s.flags));
    assert.equal(s.partyNameRead, 'Al-Madina');
    // review order puts rows that need attention first, so compare by name
    const rows = [...s.lines].sort((a: any, b: any) => a.rawName.localeCompare(b.rawName));
    assert.deepEqual(rows.map((l: any) => [l.rawName, l.qtyMilli, l.ratePaisa]), [['Gate valve', 2000, 90000], ['PVC pipe 1 inch', 10000, 45000]]);
    assert.equal(rows[1].product?.name, 'PVC Pipe 1 inch', 'matched to the catalog');
    assert.equal(s.readTotalPaisa, 630000);
    const log = await db.aiCallLog.findFirstOrThrow({ where: { scanId: s.id } });
    assert.deepEqual([log.provider, log.tokensIn, log.tokensOut, log.costMicroUsd], ['hosted:openai', 1000, 200, 720n]);
    assert.equal(fake.calls.at(-1)!.headers.authorization, 'Bearer sk-hosted-test-0000000000');

    const over = await scan();
    assert.ok(over.flags.includes('AI_QUOTA_REACHED'), 'limit of 1 scan reached');
    assert.equal(over.aiReads, false);
    const u = (await api.call('GET', '/settings/ai', 'owner')).json.usage;
    assert.equal(u.usedThisMonth, 1);
    assert.equal(u.costThisMonthMicroUsd, 720);
  });

  test("the shop's own Gemini key: stored encrypted, never shown, used for reading, no QSSols limit (FR-SET-02, NFR-SEC-01)", async () => {
    const key = 'AIzaSy-own-shop-key-ABCD';
    assert.equal((await api.call('PUT', '/settings/ai', 'owner', { mode: 'gemini' })).status, 400, 'a key is needed');
    const saved = await api.call('PUT', '/settings/ai', 'owner', { mode: 'gemini', apiKey: key, model: 'gemini-test-model' });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.keyLast4, 'ABCD');
    assert.ok(!JSON.stringify(saved.json).includes('own-shop-key'));
    const row = await db.aiSetting.findUniqueOrThrow({ where: { shopId: id.shop } });
    assert.ok(!Buffer.from(row.apiKeyEnc!).toString('latin1').includes('own-shop-key'), 'encrypted at rest');
    const audit = await db.auditLog.findMany({ where: { shopId: id.shop, action: 'settings.ai' } });
    assert.ok(!JSON.stringify(audit).includes('own-shop-key'), 'not in the audit log either');

    fake.answer([{ bill: reading }]);
    const tested = await api.call('POST', '/settings/ai/test', 'owner', {});
    assert.equal(tested.json.ok, true, JSON.stringify(tested.json));
    assert.equal(fake.calls.at(-1)!.headers['x-goog-api-key'], key);
    assert.equal(fake.calls.at(-1)!.path, '/models/gemini-test-model:generateContent');

    fake.answer([{ bill: reading }]);
    const s = await scan();
    assert.equal(s.aiReads, true, JSON.stringify(s.flags));
    assert.equal(s.lines.length, 2);
    assert.equal((await db.aiCallLog.findFirstOrThrow({ where: { scanId: s.id } })).provider, 'gemini');

    // FR-SCAN-09: the same bill (party + total) read again after it was confirmed
    await db.scan.update({ where: { id: s.id }, data: { status: 'CONFIRMED' } });
    fake.answer([{ bill: reading }]);
    assert.ok((await scan()).flags.includes('DUPLICATE_BILL'));

    fake.answer([{ status: 401, raw: { error: { message: 'API key not valid' } } }]);
    const bad = await api.call('POST', '/settings/ai/test', 'owner', { mode: 'gemini', apiKey: 'AIzaSy-wrong-key-000000' });
    assert.deepEqual([bad.json.ok, bad.json.error], [false, 'The AI key was refused (check the key in AI settings)']);

    fake.answer([{ status: 500, raw: { error: { message: 'internal' } } }]);
    const failed = await scan();
    assert.equal(failed.status, 'FAILED', 'the scan offers retry or manual entry (FR-AI-07)');
    assert.match(failed.failureReason, /AI service error 500/);
  });

  test('switching AI off or withdrawing consent puts scans in manual mode', async () => {
    await api.call('PUT', '/settings/ai', 'owner', { mode: 'off' });
    fake.calls.length = 0;
    assert.equal((await scan()).aiReads, false);
    await api.call('PUT', '/settings/ai', 'owner', { mode: 'hosted' });
    await api.call('POST', '/settings/ai/consent/withdraw', 'owner');
    assert.ok((await scan()).flags.includes('AI_NO_CONSENT'));
    assert.equal(fake.calls.length, 0);
  });

  test('photos older than the retention period are removed; the scan and its lines stay (FR-AI-16)', async () => {
    const saved = await api.call('PUT', '/settings/ai', 'owner', { mode: 'hosted', photoRetentionDays: 30 });
    assert.equal(saved.json.photoRetentionDays, 30);
    const old = await db.scan.findFirstOrThrow({ where: { shopId: id.shop, lines: { some: {} } } });
    await db.scan.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 31 * 86400_000) } });
    const removed = await app.get(ScansService).removeExpiredPhotos();
    assert.equal(removed, 1);
    assert.equal((await api.call('GET', `/scans/${old.id}/pages/1`, 'store')).status, 404);
    assert.equal((await api.call('GET', `/scans/${old.id}`, 'store')).json.lines.length, 2);
    assert.equal(await app.get(ScansService).removeExpiredPhotos(), 0, 'nothing else is old enough');
  });
});
