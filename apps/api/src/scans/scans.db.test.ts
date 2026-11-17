/**
 * Scan flow against PostgreSQL: upload → demo AI reading → checks → matching → review → confirm.
 * Run with: npm run test:db --workspace @erp/api
 */
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import type { AppConfig } from '../config.js';
import { DemoAiProvider } from './ai-provider.js';

const url = process.env.TEST_DATABASE_URL;
const rs = (n: number) => n * 100;
const q = (n: number) => n * 1000;
const fakePhoto = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(2000)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('scan flow against PostgreSQL', { skip: !url && 'TEST_DATABASE_URL not set (run npm run test:db)' }, () => {
  let app: INestApplication;
  let base: string;
  let db: PrismaClient;
  let demo: DemoAiProvider;
  const tok: Record<string, string> = {};
  const id: Record<string, any> = {};
  const purchasePhoto = fakePhoto();
  const salePhoto = fakePhoto();

  async function call(method: string, path: string, who: 'owner' | 'sales' | 'store', body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok[who]}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }

  async function upload(who: 'owner' | 'sales' | 'store', type: string, photos: Buffer[]) {
    const form = new FormData();
    form.set('type', type);
    for (const p of photos) form.append('pages', new Blob([p], { type: 'image/png' }), 'bill.png');
    const res = await fetch(base + '/scans', { method: 'POST', headers: { authorization: `Bearer ${tok[who]}` }, body: form });
    return { status: res.status, json: await res.json() };
  }

  async function ready(scanId: string) {
    for (let i = 0; i < 100; i++) {
      const r = await call('GET', `/scans/${scanId}`, 'owner');
      if (r.json.status !== 'PROCESSING') return r.json;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error('scan did not finish');
  }

  const bySerial = (scan: any, n: number) => scan.lines.find((l: any) => l.serialNo === n);
  const edits = (scan: any) => scan.lines.map((l: any) => ({ id: l.id, serialNo: l.serialNo, page: l.page, rawName: l.rawName, qtyMilli: l.qtyMilli, unit: l.unit, ratePaisa: l.ratePaisa, productId: l.product?.id ?? null }));

  before(async () => {
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    const shop = await db.shop.create({ data: { name: 'Haji Sanitary & Electric', address: 'Shop 14, Hall Road', phone: '042-1111111', settings: {} } });
    id.shop = shop.id;
    const pw = await hashPassword('test-pass-1');
    for (const [role, phone] of [['OWNER', '03000000000'], ['SALESMAN', '03010000000'], ['STOREKEEPER', '03020000000']] as const) {
      await db.user.create({ data: { shopId: shop.id, name: role.toLowerCase(), phone, role, passwordHash: pw } });
    }
    await db.party.create({ data: { shopId: shop.id, name: 'Walk-in', normalizedName: 'walk in', type: 'CUSTOMER' } });
    id.supplier = (await db.party.create({ data: { shopId: shop.id, name: 'Al-Madina Sanitary Store', normalizedName: 'al madina sanitary store', type: 'SUPPLIER' } })).id;
    id.customer = (await db.party.create({ data: { shopId: shop.id, name: 'Rana Builders', normalizedName: 'rana builders', type: 'CUSTOMER', phone: '0300-7654321' } })).id;

    const config: AppConfig = {
      DATABASE_URL: url!,
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
    app = await createApp(config, {}, { quiet: true });
    await app.listen(0);
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    for (const [k, phone] of [['owner', '03000000000'], ['sales', '03010000000'], ['store', '03020000000']] as const) {
      const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: phone, password: 'test-pass-1' }) });
      tok[k] = (await r.json()).accessToken;
    }
    for (const [key, name, buy, sell] of [['pipe', 'PVC Pipe 1 inch – 10 ft', 450, 650], ['elbow', 'Elbow Joint 1 inch', 35, 60], ['board', 'Switch Board 8-gang', 600, 780], ['valve', 'Ball Valve ½ inch', 260, 340]] as const) {
      id[key] = (await call('POST', '/products', 'owner', { name, purchasePricePaisa: rs(buy), salePricePaisa: rs(sell) })).json.id;
    }

    demo = app.get(DemoAiProvider);
    // Supplier bill: row 5 was dropped by the "AI", row 3 is a new item, row 6 is unsure.
    demo.register({
      sha256: sha(purchasePhoto),
      result: {
        partyName: 'Al-Madina Sanitary',
        billNo: '2417',
        date: '2026-11-10',
        billTotal: 108700,
        lines: [
          { line_no: 1, raw_name: 'PVC pipe 1" 10ft', qty: 50, unit: 'pcs', rate: 450, line_total: 22500, confidence: 0.97 },
          { line_no: 2, raw_name: 'Elbow 1"', qty: 100, unit: null, rate: 35, line_total: 3500, confidence: 0.96 },
          { line_no: 3, raw_name: 'Ceiling fan 48"', qty: 12, unit: 'pcs', rate: 3850, line_total: 46200, confidence: 0.95 },
          { line_no: 4, raw_name: '8 gang board', qty: 30, unit: 'pcs', rate: 620, line_total: 18600, confidence: 0.93 },
          { line_no: 6, raw_name: 'Ball valve ½', qty: 40, unit: 'pcs', rate: 260, line_total: 10400, confidence: 0.7 },
        ],
      },
    });
    demo.register({
      sha256: sha(salePhoto),
      result: {
        partyName: 'Rana Builders',
        billNo: '0883',
        date: '2026-11-11',
        billTotal: 32500,
        lines: [
          { line_no: 1, raw_name: 'Elbow 1"', qty: 500, unit: null, rate: 60, line_total: 30000, confidence: 0.95 },
          { line_no: 2, raw_name: 'PVC pipe 1"', qty: 5, unit: null, rate: null, line_total: null, confidence: 0.9 },
        ],
      },
    });
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  test('purchase scan: checks find the dropped row, the new item and the unsure line (FR-AI-04/13, FR-REV-03/04/09)', async () => {
    assert.equal((await upload('sales', 'PURCHASE', [purchasePhoto])).status, 403, 'salesman cannot scan purchases');
    const up = await upload('store', 'PURCHASE', [purchasePhoto]);
    assert.equal(up.status, 201, JSON.stringify(up.json));
    id.scan1 = up.json.id;
    const s = await ready(id.scan1);
    assert.equal(s.status, 'NEEDS_REVIEW', s.failureReason);
    assert.equal(s.aiReads, false, 'demo mode is reported so the UI can say the reading is simulated');
    for (const f of ['DEMO_MODE', 'ROWS_MAY_BE_MISSING', 'TOTAL_MISMATCH']) assert.ok(s.flags.includes(f), f);
    assert.deepEqual(s.missingSerials, [5]);
    assert.equal(s.suggestedParty?.id, id.supplier, 'party name read from the photo is matched (FR-PTY-04)');
    assert.equal(bySerial(s, 1).product.id, id.pipe);
    assert.equal(bySerial(s, 2).product.id, id.elbow);
    assert.ok(bySerial(s, 3).flags.includes('NEW_PRODUCT'));
    assert.equal(bySerial(s, 3).product, null);
    assert.deepEqual(bySerial(s, 4).priceDiff, { listPaisa: rs(600), writtenPaisa: rs(620) });
    assert.ok(bySerial(s, 6).flags.includes('LOW_CONFIDENCE'));
    assert.equal(s.lines[0].serialNo, 6, 'least confident flagged row is shown first (FR-REV-14)');
    assert.equal(s.blockingCount, 1);
    const img = await fetch(`${base}/scans/${id.scan1}/pages/1`, { headers: { authorization: `Bearer ${tok.store}` } });
    assert.ok(Buffer.from(await img.arrayBuffer()).equals(purchasePhoto), 'photo is stored as proof (FR-SCAN-08)');
  });

  test('confirm is blocked until every row is fixed', async () => {
    const r = await call('POST', `/scans/${id.scan1}/confirm`, 'store', { partyId: id.supplier });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'REVIEW_INCOMPLETE');
    assert.match(r.json.problems[0], /Ceiling fan/);
  });

  test('review: create the new product, add the missing row, autosave (FR-REV-02/10/11/15)', async () => {
    const s = (await call('GET', `/scans/${id.scan1}`, 'store')).json;
    const fan = await call('POST', '/products', 'store', { name: 'Ceiling Fan 48 inch', purchasePricePaisa: rs(3850) });
    const dinner = await call('POST', '/products', 'store', { name: 'Dinner Set 24 pcs', purchasePricePaisa: rs(7500) });
    id.fan = fan.json.id;
    const lines = edits(s).map((l: any) => (l.serialNo === 3 ? { ...l, productId: id.fan } : l));
    lines.push({ serialNo: 5, page: 1, rawName: 'Dinner set 24pc', qtyMilli: q(1), unit: 'pcs', ratePaisa: rs(7500), productId: dinner.json.id });
    const saved = await call('PUT', `/scans/${id.scan1}/lines`, 'store', { lines });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.blockingCount, 0);
    assert.equal(saved.json.lines.length, 6);
    assert.equal(saved.json.linesTotalPaisa, rs(108700), 'lines now add up to the bill total');
    assert.equal(bySerial(saved.json, 3).flags.includes('NEW_PRODUCT'), false);
  });

  test('confirm posts stock, learns aliases per supplier and is safe to repeat (BR-5, FR-REV-05, FR-PRD-08)', async () => {
    const r = await call('POST', `/scans/${id.scan1}/confirm`, 'store', { partyId: id.supplier }, { 'idempotency-key': 'scan1-confirm' });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.kind, 'PURCHASE');
    assert.equal(r.json.totalPaisa, rs(108700));
    assert.equal(r.json.scanId, id.scan1);
    id.purchaseDoc = r.json.id;
    const again = await call('POST', `/scans/${id.scan1}/confirm`, 'store', { partyId: id.supplier });
    assert.equal(again.json.id, r.json.id);
    assert.equal((await call('GET', `/products/${id.pipe}`, 'owner')).json.onHandMilli, q(50));
    assert.equal((await call('GET', `/products/${id.board}`, 'owner')).json.purchasePricePaisa, rs(620));
    const alias = await db.productAlias.findFirst({ where: { productId: id.elbow, normalized: 'elbow 1in' } });
    assert.equal(alias?.partyId, id.supplier);
    assert.equal((await call('GET', `/scans/${id.scan1}`, 'owner')).json.status, 'CONFIRMED');
    assert.equal((await call('PUT', `/scans/${id.scan1}/lines`, 'store', { lines: [] })).status, 409, 'confirmed scans are locked');
  });

  test('the same photo again is flagged as a duplicate and can be discarded (FR-SCAN-09)', async () => {
    const up = await upload('owner', 'PURCHASE', [purchasePhoto]);
    const s = await ready(up.json.id);
    assert.ok(s.flags.includes('DUPLICATE_PHOTO'));
    assert.equal(bySerial(s, 2).matchStatus, 'alias', 'learned alias matches next time');
    assert.equal((await call('POST', `/scans/${s.id}/discard`, 'owner')).json.status, 'DISCARDED');
    assert.equal((await call('POST', `/scans/${s.id}/confirm`, 'owner', { partyId: id.supplier })).status, 409);
  });

  test('sale scan: short stock blocks, missing rate comes from the list price (FR-REV-07/08)', async () => {
    const up = await upload('sales', 'SALE', [salePhoto]);
    const s = await ready(up.json.id);
    id.scan2 = s.id;
    const elbow = bySerial(s, 1);
    const pipe = bySerial(s, 2);
    assert.equal(elbow.shortStock, true);
    assert.equal(pipe.ratePaisa, rs(650));
    assert.ok(pipe.flags.includes('RATE_FROM_LIST'));
    assert.equal(s.blockingCount, 1);
    const fixed = edits(s).map((l: any) => (l.serialNo === 1 ? { ...l, qtyMilli: q(40) } : l));
    const saved = (await call('PUT', `/scans/${s.id}/lines`, 'sales', { lines: fixed })).json;
    assert.equal(saved.blockingCount, 0);
    const r = await call('POST', `/scans/${s.id}/confirm`, 'sales', { partyId: id.customer, payments: [{ mode: 'CASH', amountPaisa: rs(2000) }] });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.receiptNo, 'R-000001');
    assert.equal(r.json.totalPaisa, rs(2400 + 3250));
    assert.equal(r.json.balanceDuePaisa, rs(3650));
    id.sale = r.json.id;
  });

  test('receipt prints and shares (FR-RCP-01/03/07)', async () => {
    const html = await call('GET', `/documents/${id.sale}/receipt?paper=80`, 'sales');
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type') ?? '', /text\/html/);
    for (const s of ['Haji Sanitary &amp; Electric', 'R-000001', 'Rana Builders', 'not an FBR-verified tax invoice', 'Balance (udhaar)']) assert.ok(html.json.includes(s), s);
    const share = (await call('GET', `/documents/${id.sale}/share`, 'sales')).json;
    assert.match(share.whatsappUrl, /^https:\/\/wa\.me\/923007654321\?text=/);
    assert.match(share.text, /Total: Rs 5,650/);
    assert.equal((await call('GET', `/documents/${id.purchaseDoc}/receipt`, 'owner')).status, 404, 'purchases have no receipt');
  });

  test('a photo the demo provider does not know opens empty rows for manual entry (FR-AI-08)', async () => {
    const up = await upload('sales', 'SALE', [fakePhoto(), fakePhoto()]);
    const s = await ready(up.json.id);
    assert.equal(s.status, 'NEEDS_REVIEW');
    assert.equal(s.pageCount, 2);
    assert.equal(s.lines.length, 0);
    assert.ok(s.flags.includes('DEMO_MODE'));
    assert.equal((await call('POST', `/scans/${s.id}/confirm`, 'sales', {})).status, 400);
  });

  test('upload limits (FR-SCAN-02/03)', async () => {
    const tooMany = await upload('owner', 'SALE', Array.from({ length: 11 }, fakePhoto));
    assert.ok(tooMany.status === 400 || tooMany.status === 413, String(tooMany.status));
    const form = new FormData();
    form.set('type', 'SALE');
    form.append('pages', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'a.pdf');
    const res = await fetch(base + '/scans', { method: 'POST', headers: { authorization: `Bearer ${tok.owner}` }, body: form });
    assert.equal(res.status, 400);
  });

});
