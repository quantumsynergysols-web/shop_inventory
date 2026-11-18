/**
 * Returns (FR-STK-06), stock adjustment (FR-STK-07) and opening-stock import (FR-STK-08) against PostgreSQL.
 * Run with: npm run test:db --workspace @erp/api
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { client, makeShop, resetDb, startApp } from '../test-support/db-app.js';

const url = process.env.TEST_DATABASE_URL;
const rs = (n: number) => n * 100;
const q = (n: number) => n * 1000;

describe('returns, adjustments and opening stock against PostgreSQL', { skip: !url && 'TEST_DATABASE_URL not set (run npm run test:db)' }, () => {
  let app: INestApplication;
  let db: PrismaClient;
  let api: ReturnType<typeof client>;
  const id: Record<string, any> = {};

  before(async () => {
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    await resetDb(db);
    const a = await makeShop(db, 'Haji Sanitary', '0330');
    id.shop = a.shop.id;
    ({ app } = await startApp(url!));
    api = client(`http://127.0.0.1:${app.getHttpServer().address().port}/api`);
    for (const [k, role] of [['owner', 'OWNER'], ['sales', 'SALESMAN'], ['store', 'STOREKEEPER']] as const) await api.login(k, a.phones[role]!);
    const { call } = api;
    id.pipe = (await call('POST', '/products', 'owner', { name: 'PVC Pipe 1 inch', purchasePricePaisa: rs(450), salePricePaisa: rs(650), minLevel: 15 })).json.id;
    id.fan = (await call('POST', '/products', 'owner', { name: 'Ceiling Fan 48 inch', purchasePricePaisa: rs(3850), salePricePaisa: rs(4800), minLevel: 4 })).json.id;
    id.supplier = (await call('POST', '/parties', 'owner', { name: 'Al-Madina', type: 'SUPPLIER' })).json.id;
    id.customer = (await call('POST', '/parties', 'owner', { name: 'Rana Builders', type: 'CUSTOMER' })).json.id;
    const p = await call('POST', '/documents', 'store', { kind: 'PURCHASE', partyId: id.supplier, lines: [{ productId: id.pipe, qtyMilli: q(100), ratePaisa: rs(450) }, { productId: id.fan, qtyMilli: q(10), ratePaisa: rs(3850) }] });
    assert.equal(p.status, 201, JSON.stringify(p.json));
    id.purchase = p.json.id;
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const product = async (pid: string) => (await api.call('GET', `/products/${pid}`, 'owner')).json;
  const party = async (pid: string) => (await api.call('GET', `/parties/${pid}`, 'owner')).json;

  test('sales return: part of a credit bill, discount shared out, stock back at its cost (FR-STK-06, BR-3)', async () => {
    const { call } = api;
    // 10 pipes @ 650 = 6,500, discount 500 → 6,000; Rs 2,000 cash, 4,000 udhaar
    const sale = await call('POST', '/documents', 'sales', { kind: 'SALE', partyId: id.customer, lines: [{ productId: id.pipe, qtyMilli: q(10), ratePaisa: rs(650) }], discountPaisa: rs(500), payments: [{ mode: 'CASH', amountPaisa: rs(2000) }] });
    assert.equal(sale.status, 201, JSON.stringify(sale.json));
    id.sale = sale.json.id;
    assert.equal((await party(id.customer)).balancePaisa, rs(4000));

    assert.equal((await call('POST', `/documents/${id.sale}/return`, 'store', { lines: [{ lineNo: 1, qtyMilli: q(1) }], reason: 'broken' })).status, 403, 'storekeeper cannot take sales returns');
    assert.equal((await call('POST', `/documents/${id.sale}/return`, 'sales', { lines: [{ lineNo: 1, qtyMilli: q(11) }], reason: 'too many' })).status, 400);

    // 4 back: 2,600 × 6,000 / 6,500 = 2,400; Rs 1,000 cash back, 1,400 off the udhaar
    const r = await call('POST', `/documents/${id.sale}/return`, 'sales', { lines: [{ lineNo: 1, qtyMilli: q(4) }], refunds: [{ mode: 'CASH', amountPaisa: rs(1000) }], reason: 'customer did not need them' });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.kind, 'SALES_RETURN');
    assert.match(r.json.docNo, /^SRT-/);
    assert.equal(r.json.totalPaisa, rs(2400));
    assert.equal(r.json.returnOfDocId, id.sale);
    assert.equal((await party(id.customer)).balancePaisa, rs(2600));
    const pipe = await product(id.pipe);
    assert.equal(pipe.onHandMilli, q(94));
    assert.equal(pipe.stockValuePaisa, rs(94 * 450));

    const orig = (await call('GET', `/documents/${id.sale}`, 'owner')).json;
    assert.equal(orig.status, 'PARTIALLY_RETURNED');
    assert.equal(orig.lines[0].returnedMilli, q(4));
    assert.equal(orig.returns.length, 1);

    assert.equal((await call('POST', `/documents/${id.sale}/return`, 'sales', { lines: [{ lineNo: 1, qtyMilli: q(7) }], reason: 'more' })).status, 400, 'only 6 left');
    const r2 = await call('POST', `/documents/${id.sale}/return`, 'owner', { lines: [{ lineNo: 1, qtyMilli: q(6) }], reason: 'rest of it' });
    assert.equal(r2.status, 201, JSON.stringify(r2.json));
    assert.equal(r2.json.totalPaisa, rs(3600));
    assert.equal((await call('GET', `/documents/${id.sale}`, 'owner')).json.status, 'FULLY_RETURNED');
    assert.equal((await party(id.customer)).balancePaisa, -rs(1000), 'the customer now has Rs 1,000 credit with the shop');
    assert.equal((await call('POST', `/documents/${id.sale}/return`, 'owner', { lines: [{ lineNo: 1, qtyMilli: q(1) }], reason: 'again' })).status, 409);
    assert.equal((await call('POST', `/documents/${r2.json.id}/void`, 'owner', { reason: 'undo the return' })).status, 400, 'a return cannot be voided');
    assert.equal((await call('POST', `/documents/${id.sale}/void`, 'owner', { reason: 'undo' })).status, 409, 'a returned sale cannot be voided');
  });

  test('walk-in return is refunded in full and a double tap posts once (NFR-REL-02)', async () => {
    const { call } = api;
    const sale = await call('POST', '/documents', 'sales', { kind: 'SALE', lines: [{ productId: id.fan, qtyMilli: q(2), ratePaisa: rs(4800) }], payments: [{ mode: 'CASH', amountPaisa: rs(9600) }] });
    assert.equal(sale.status, 201);
    assert.equal((await call('POST', `/documents/${sale.json.id}/return`, 'sales', { lines: [{ lineNo: 1, qtyMilli: q(1) }], refunds: [{ mode: 'CASH', amountPaisa: rs(1000) }], reason: 'faulty' })).status, 400);
    const body = { lines: [{ lineNo: 1, qtyMilli: q(1) }], refunds: [{ mode: 'CASH', amountPaisa: rs(4800) }], reason: 'faulty' };
    const a = await call('POST', `/documents/${sale.json.id}/return`, 'sales', body, { 'idempotency-key': 'ret-fan-1' });
    const b = await call('POST', `/documents/${sale.json.id}/return`, 'sales', body, { 'idempotency-key': 'ret-fan-1' });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    assert.equal(b.json.id, a.json.id);
    assert.equal((await product(id.fan)).onHandMilli, q(9));
  });

  test('purchase return lowers what we owe the supplier (FR-STK-06)', async () => {
    const { call } = api;
    assert.equal((await party(id.supplier)).balancePaisa, -rs(45000 + 38500));
    assert.equal((await call('POST', `/documents/${id.purchase}/return`, 'sales', { lines: [{ lineNo: 2, qtyMilli: q(1) }], reason: 'damaged' })).status, 403, 'salesman cannot return purchases');
    const r = await call('POST', `/documents/${id.purchase}/return`, 'store', { lines: [{ lineNo: 2, qtyMilli: q(2) }], reason: 'damaged in transport' });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.match(r.json.docNo, /^PRT-/);
    assert.equal(r.json.totalPaisa, rs(7700));
    assert.equal((await party(id.supplier)).balancePaisa, -rs(45000 + 38500 - 7700));
    assert.equal((await product(id.fan)).onHandMilli, q(7));
    assert.equal((await call('GET', `/documents/${id.purchase}`, 'owner')).json.status, 'PARTIALLY_RETURNED');
    // The ledger stays balanced for every return
    const sums = await db.ledgerEntry.aggregate({ where: { shopId: id.shop }, _sum: { debitPaisa: true, creditPaisa: true } });
    assert.equal(sums._sum.debitPaisa, sums._sum.creditPaisa);
  });

  test('day closing counts returns and their refunds (BR-8)', async () => {
    const s = (await api.call('GET', '/day', 'owner')).json.summary;
    assert.equal(s.salesReturnsPaisa, rs(2400 + 3600 + 4800));
    assert.equal(s.saleTotalPaisa, rs(6000 + 9600) - rs(2400 + 3600 + 4800));
    assert.equal(s.cashRefundsPaisa, rs(1000 + 4800));
    assert.equal(s.purchasesPaisa, rs(45000 + 38500 - 7700));
    // Cash: 2,000 + 9,600 in, 5,800 refunded
    assert.equal(s.expectedCashPaisa, rs(2000 + 9600 - 5800));
    const dash = (await api.call('GET', '/dashboard', 'owner')).json;
    assert.equal(dash.salesTodayPaisa, s.saleTotalPaisa);
  });

  test('stock adjustment and physical count, owner only (FR-STK-07)', async () => {
    const { call } = api;
    assert.equal((await call('POST', '/adjustments', 'store', { reason: 'count', lines: [{ productId: id.pipe, countedMilli: q(90) }] })).status, 403);
    assert.equal((await call('POST', '/adjustments', 'owner', { reason: 'count', lines: [{ productId: id.pipe, countedMilli: q(100) }] })).status, 400, 'already 100');
    // Counted 97 pipes (3 missing) and found 1 extra fan
    const r = await call('POST', '/adjustments', 'owner', { reason: 'monthly count', lines: [{ productId: id.pipe, countedMilli: q(97) }, { productId: id.fan, deltaMilli: q(1) }] }, { 'idempotency-key': 'count-1' });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual(r.json.map((d: any) => d.kind).sort(), ['ADJUST_IN', 'ADJUST_OUT']);
    const out = r.json.find((d: any) => d.kind === 'ADJUST_OUT');
    assert.equal(out.totalPaisa, rs(3 * 450));
    assert.equal((await product(id.pipe)).onHandMilli, q(97));
    assert.equal((await product(id.fan)).onHandMilli, q(8));
    const again = await call('POST', '/adjustments', 'owner', { reason: 'monthly count', lines: [{ productId: id.pipe, countedMilli: q(97) }, { productId: id.fan, deltaMilli: q(1) }] }, { 'idempotency-key': 'count-1' });
    assert.equal(again.json.length, 2);
    assert.equal((await product(id.fan)).onHandMilli, q(8), 'posted once');
    assert.equal((await call('POST', '/adjustments', 'owner', { reason: 'too much', lines: [{ productId: id.fan, deltaMilli: -q(50) }] })).status, 409, 'cannot go below zero');
  });

  test('opening stock import from CSV and Excel with preview (FR-STK-08)', async () => {
    const { call, upload } = api;
    const tpl = await call('GET', '/opening-stock/template.csv', 'owner');
    assert.equal(tpl.status, 200);
    assert.match(String(tpl.json), /name,sku,category,unit,qty,cost/);
    assert.equal((await call('GET', '/opening-stock/template.csv', 'store')).status, 403);

    const bad = Buffer.from(
      'name,category,unit,qty,cost,sale price,aliases\n' +
        'Ball Valve 1/2 inch,Plumbing,pcs,40,"1,250",1600,valve half;ball wal\n' +
        'Teflon Tape,Plumbing,roll,abc,30,,\n' +
        'PVC Pipe 1 inch,,pcs,5,450,,\n' +
        'Bulb 12W,Electrical,litre,10,180,,\n',
    );
    const pre = await upload('/opening-stock?dryRun=1', 'owner', 'file', bad, 'stock.csv');
    assert.equal(pre.status, 201, JSON.stringify(pre.json));
    assert.equal(pre.json.rows.length, 4);
    assert.equal(pre.json.okRows, 1);
    assert.equal(pre.json.rows[0].costPaisa, rs(1250));
    assert.deepEqual(pre.json.rows[0].aliases, ['valve half', 'ball wal']);
    assert.match(pre.json.rows[1].errors.join(), /qty/);
    assert.match(pre.json.rows[2].errors.join(), /stock adjustment/, 'pipe already has stock entries');
    assert.match(pre.json.rows[3].errors.join(), /unit/);
    assert.equal((await upload('/opening-stock', 'owner', 'file', bad, 'stock.csv')).status, 400, 'nothing saved while rows have errors');
    assert.equal(await db.product.count({ where: { shopId: id.shop, name: 'Ball Valve 1/2 inch' } }), 0);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Stock');
    ws.addRow(['Name', 'Category', 'Unit', 'Qty', 'Cost', 'Sale price', 'Min level', 'Aliases']);
    ws.addRow(['Ball Valve 1/2 inch', 'Plumbing', 'pcs', 40, 1250, 1600, 10, 'valve half']);
    ws.addRow(['Teflon Tape', 'Plumbing', 'roll', 25.5, 30, '', '', '']);
    ws.addRow(['Bulb 12W', 'Electrical', 'pcs', 0, '', 250, '', '']);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    const done = await upload('/opening-stock', 'owner', 'file', xlsx, 'stock.xlsx');
    assert.equal(done.status, 201, JSON.stringify(done.json));
    assert.equal(done.json.preview.newProducts, 3);
    assert.equal(done.json.document.kind, 'OPENING');
    assert.equal(done.json.document.lines.length, 2, 'zero-qty bulb is created without a stock line');
    assert.equal(done.json.document.totalPaisa, rs(40 * 1250) + rs(765));
    const valve = await db.product.findFirstOrThrow({ where: { shopId: id.shop, name: 'Ball Valve 1/2 inch' }, include: { aliases: true, category: true } });
    assert.equal((await product(valve.id)).onHandMilli, q(40));
    assert.equal(valve.category?.name, 'Plumbing');
    assert.equal(valve.aliases[0]?.text, 'valve half');
    assert.equal((await upload('/opening-stock?dryRun=1', 'owner', 'file', xlsx, 'stock.xlsx')).json.errorRows, 2, 'a second import of stocked products is refused');
  });
});
