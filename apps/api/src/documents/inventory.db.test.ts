/**
 * Integration tests against a real PostgreSQL database (shop_erp_test).
 * Run with: npm run test:db --workspace @erp/api   (skipped by plain `npm test`)
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import type { AppConfig } from '../config.js';

const url = process.env.TEST_DATABASE_URL;
const rs = (n: number) => n * 100;
const q = (n: number) => n * 1000;

describe('inventory against PostgreSQL', { skip: !url && 'TEST_DATABASE_URL not set (run npm run test:db)' }, () => {
  let app: INestApplication;
  let base: string;
  let db: PrismaClient;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  async function call(method: string, path: string, who: 'owner' | 'sales' | 'store' | null, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  before(async () => {
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);

    const shop = await db.shop.create({ data: { name: 'Test Shop', settings: { markupPct: 25, allowNegativeStock: false, lowStockDefault: 5 } } });
    const pw = await hashPassword('test-pass-1');
    for (const [key, role, phone] of [['owner', 'OWNER', '0300'], ['sales', 'SALESMAN', '0301'], ['store', 'STOREKEEPER', '0302']] as const) {
      await db.user.create({ data: { shopId: shop.id, name: key, phone: `${phone}0000000`, role, passwordHash: pw } });
    }
    await db.party.create({ data: { shopId: shop.id, name: 'Walk-in', normalizedName: 'walk in', type: 'CUSTOMER' } });

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
    };
    app = await createApp(config, {}, { quiet: true });
    await app.listen(0);
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    for (const [key, phone] of [['owner', '03000000000'], ['sales', '03010000000'], ['store', '03020000000']] as const) {
      const r = await call('POST', '/auth/login', null, { login: phone, password: 'test-pass-1' });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      tokens[key] = r.json.accessToken;
    }
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  test('products and parties are created and found by typo search', async () => {
    const cats = await call('GET', '/categories', 'owner');
    assert.equal(cats.status, 200);
    const pipe = await call('POST', '/products', 'owner', { name: 'PVC Pipe 1 inch – 10 ft', purchasePricePaisa: rs(450), salePricePaisa: rs(650), minLevel: 15, aliases: ['pvc pipe 1"'] });
    assert.equal(pipe.status, 201, JSON.stringify(pipe.json));
    assert.equal(pipe.json.sku, 'P-00001');
    ids.pipe = pipe.json.id;
    const fan = await call('POST', '/products', 'store', { name: 'Ceiling Fan 48 inch', purchasePricePaisa: rs(3850) });
    assert.equal(fan.status, 201);
    assert.equal(fan.json.salePricePaisa, rs(4810), 'suggested sale price = purchase × (1 + 25 % markup), rounded to Rs 10 (FR-REV-10)');
    ids.fan = fan.json.id;
    assert.equal((await call('PATCH', `/products/${ids.fan}`, 'store', { salePricePaisa: rs(1) })).status, 403, 'storekeeper cannot edit prices');

    const found = await call('GET', '/products?q=' + encodeURIComponent('celing fan'), 'sales');
    assert.equal(found.json[0]?.id, ids.fan, 'typo "celing" still finds the fan (pg_trgm)');

    const sup = await call('POST', '/parties', 'store', { name: 'Al-Madina Sanitary Store', type: 'SUPPLIER', phone: '0421234567' });
    assert.equal(sup.status, 201);
    ids.supplier = sup.json.id;
    assert.equal((await call('POST', '/parties', 'sales', { name: 'X', type: 'SUPPLIER' })).status, 403, 'salesman cannot add suppliers');
    const cust = await call('POST', '/parties', 'sales', { name: 'Rana Builders', type: 'CUSTOMER' });
    ids.customer = cust.json.id;
  });

  test('purchases post stock IN with weighted average cost (BR-2) and update the purchase price', async () => {
    const p1 = await call('POST', '/documents', 'store', { kind: 'PURCHASE', partyId: ids.supplier, lines: [{ productId: ids.pipe, qtyMilli: q(20), ratePaisa: rs(450) }, { productId: ids.fan, qtyMilli: q(12), ratePaisa: rs(3850) }] });
    assert.equal(p1.status, 201, JSON.stringify(p1.json));
    assert.equal(p1.json.docNo, 'PUR-000001');
    assert.equal(p1.json.totalPaisa, rs(9000 + 46200));
    assert.equal(p1.json.payStatus, 'UNPAID');
    const p2 = await call('POST', '/documents', 'owner', { kind: 'PURCHASE', partyId: ids.supplier, lines: [{ productId: ids.pipe, qtyMilli: q(50), ratePaisa: rs(470) }], payments: [{ mode: 'BANK', amountPaisa: rs(10000) }] });
    assert.equal(p2.status, 201);
    assert.deepEqual([p2.json.lines[0].stockBeforeMilli, p2.json.lines[0].stockAfterMilli], [q(20), q(70)]);
    const pipe = (await call('GET', `/products/${ids.pipe}`, 'owner')).json;
    assert.equal(pipe.onHandMilli, q(70));
    assert.equal(pipe.stockValuePaisa, rs(32500));
    assert.equal(pipe.avgCostPaisa, 46429);
    assert.equal(pipe.purchasePricePaisa, rs(470));
    const hist = (await call('GET', `/products/${ids.pipe}/price-history`, 'owner')).json;
    assert.equal(hist[0].newPricePaisa, rs(470));
    const supplier = (await call('GET', `/parties/${ids.supplier}`, 'owner')).json;
    assert.equal(supplier.balancePaisa, -rs(55200 + 23500 - 10000), 'shop owes the supplier the unpaid amount');
  });

  test('sale posts stock OUT at average cost, makes a receipt and udhaar (FR-STK-04, FR-RCP-04, BR-7)', async () => {
    const r = await call('POST', '/documents', 'sales', {
      kind: 'SALE',
      partyId: ids.customer,
      lines: [{ productId: ids.pipe, qtyMilli: q(10), ratePaisa: rs(650) }, { productId: ids.fan, qtyMilli: q(2), ratePaisa: rs(4800) }],
      payments: [{ mode: 'CASH', amountPaisa: rs(10000) }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.receiptNo, 'R-000001');
    assert.equal(r.json.totalPaisa, rs(6500 + 9600));
    assert.equal(r.json.balanceDuePaisa, rs(6100));
    assert.equal(r.json.cogsPaisa, 464286 + rs(7700));
    assert.equal(r.json.lines[0].stockAfterMilli, q(60));
    ids.sale1 = r.json.id;
    const cust = (await call('GET', `/parties/${ids.customer}`, 'sales')).json;
    assert.equal(cust.balancePaisa, rs(6100));
  });

  test('every short line is reported and nothing is posted (FR-REV-07, FR-STK-01)', async () => {
    const before = (await call('GET', `/products/${ids.fan}`, 'owner')).json.onHandMilli;
    const r = await call('POST', '/documents', 'sales', { kind: 'SALE', lines: [{ productId: ids.fan, qtyMilli: q(11), ratePaisa: rs(4800) }], payments: [{ mode: 'CASH', amountPaisa: rs(52800) }] });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'STOCK_SHORTAGE');
    assert.equal(r.json.shortages[0].onHandMilli, q(10));
    assert.equal((await call('GET', `/products/${ids.fan}`, 'owner')).json.onHandMilli, before);
  });

  test('roles, walk-in udhaar and bad input are refused', async () => {
    assert.equal((await call('POST', '/documents', 'sales', { kind: 'PURCHASE', partyId: ids.supplier, lines: [{ productId: ids.pipe, qtyMilli: q(1), ratePaisa: 1 }] })).status, 403);
    const walkIn = await call('POST', '/documents', 'sales', { kind: 'SALE', lines: [{ productId: ids.pipe, qtyMilli: q(1), ratePaisa: rs(650) }] });
    assert.equal(walkIn.status, 400);
    assert.match(walkIn.json.message, /udhaar/);
    assert.equal((await call('POST', '/documents', 'store', { kind: 'PURCHASE', lines: [{ productId: ids.pipe, qtyMilli: q(1), ratePaisa: 1 }] })).status, 400, 'purchase needs a supplier');
  });

  test('a retried confirm with the same Idempotency-Key posts once (NFR-REL-02)', async () => {
    const body = { kind: 'SALE', lines: [{ productId: ids.pipe, qtyMilli: q(1), ratePaisa: rs(650) }], payments: [{ mode: 'CASH', amountPaisa: rs(650) }] };
    const [a, b] = await Promise.all([
      call('POST', '/documents', 'sales', body, { 'idempotency-key': 'tap-123' }),
      call('POST', '/documents', 'sales', body, { 'idempotency-key': 'tap-123' }),
    ]);
    assert.equal(a.json.id, b.json.id);
    assert.equal((await call('GET', `/products/${ids.pipe}`, 'owner')).json.onHandMilli, q(59));
  });

  test('two sales racing for the last stock: one wins, one gets 409 (row lock)', async () => {
    const sell = (n: number) => call('POST', '/documents', 'sales', { kind: 'SALE', lines: [{ productId: ids.pipe, qtyMilli: q(n), ratePaisa: rs(650) }], payments: [{ mode: 'CASH', amountPaisa: rs(650 * n) }] });
    const results = await Promise.all([sell(35), sell(35)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await call('GET', `/products/${ids.pipe}`, 'owner')).json.onHandMilli, q(24));
  });

  test('void restores stock and balances exactly (FR-STK-05, BR-6)', async () => {
    const beforePipe = (await call('GET', `/products/${ids.pipe}`, 'owner')).json;
    assert.equal((await call('POST', `/documents/${ids.sale1}/void`, 'sales', { reason: 'wrong bill' })).status, 403, 'only the owner voids');
    const v = await call('POST', `/documents/${ids.sale1}/void`, 'owner', { reason: 'customer returned whole bill' });
    assert.equal(v.status, 201, JSON.stringify(v.json));
    assert.equal(v.json.kind, 'VOID');
    assert.equal(v.json.voidsDocId, ids.sale1);
    const original = (await call('GET', `/documents/${ids.sale1}`, 'owner')).json;
    assert.equal(original.status, 'VOIDED');
    const pipe = (await call('GET', `/products/${ids.pipe}`, 'owner')).json;
    assert.equal(pipe.onHandMilli, beforePipe.onHandMilli + q(10));
    assert.equal(pipe.stockValuePaisa, beforePipe.stockValuePaisa + 464286);
    assert.equal((await call('GET', `/parties/${ids.customer}`, 'owner')).json.balancePaisa, 0);
    assert.equal((await call('POST', `/documents/${ids.sale1}/void`, 'owner', { reason: 'again' })).status, 409);
  });

  test('wasooli reduces the customer balance (FR-PTY-03)', async () => {
    await call('POST', '/documents', 'sales', { kind: 'SALE', partyId: ids.customer, lines: [{ productId: ids.fan, qtyMilli: q(1), ratePaisa: rs(4800) }] });
    const pay = await call('POST', `/parties/${ids.customer}/payments`, 'sales', { direction: 'RECEIVED', amountPaisa: rs(3000), mode: 'CASH' });
    assert.equal(pay.status, 201);
    assert.equal((await call('GET', `/parties/${ids.customer}`, 'sales')).json.balancePaisa, rs(1800));
    assert.equal((await call('POST', `/parties/${ids.supplier}/payments`, 'sales', { direction: 'PAID', amountPaisa: rs(1), mode: 'CASH' })).status, 403);
  });

  test('stock always equals the sum of its movements (BR-1, acceptance check 4)', async () => {
    const rows = await db.$queryRaw<{ name: string; on_hand: string; moved: string }[]>`
      SELECT p.name, p."onHand"::text AS on_hand, coalesce(sum(m."qtyBase"), 0)::text AS moved
      FROM product p LEFT JOIN stock_movement m ON m."productId" = p.id GROUP BY p.id`;
    for (const r of rows) assert.equal(Number(r.on_hand), Number(r.moved), r.name);
    const orphan = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM stock_movement m LEFT JOIN doc_line l ON l.id = m."docLineId" WHERE l.id IS NULL`;
    assert.equal(Number(orphan[0]!.n), 0);
  });
});
