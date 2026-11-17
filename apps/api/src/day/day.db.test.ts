/**
 * Phase 3 against PostgreSQL: day closing, expenses, dashboard, reports, users, settings, shop isolation.
 * Run with: npm run test:db --workspace @erp/api
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { businessDate } from '../common/convert.js';
import { client, makeShop, resetDb, startApp } from '../test-support/db-app.js';

const url = process.env.TEST_DATABASE_URL;
const rs = (n: number) => n * 100;
const q = (n: number) => n * 1000;

describe('day closing, reports, users and isolation against PostgreSQL', { skip: !url && 'TEST_DATABASE_URL not set (run npm run test:db)' }, () => {
  let app: INestApplication;
  let db: PrismaClient;
  let api: ReturnType<typeof client>;
  const id: Record<string, any> = {};
  const today = businessDate();

  before(async () => {
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    await resetDb(db);
    const a = await makeShop(db, 'Haji Sanitary', '0310', { closingNoteLimitPaisa: rs(500), salesmanExpenseLimitPaisa: rs(1000) });
    const b = await makeShop(db, 'Other Shop', '0320');
    id.shop = a.shop.id;
    // Yesterday was closed with Rs 15,000 counted: today's opening cash (FR-CLS-04)
    const y = new Date(`${today}T00:00:00Z`);
    y.setUTCDate(y.getUTCDate() - 1);
    await db.dayClosing.create({ data: { shopId: a.shop.id, businessDate: y, status: 'CLOSED', countedCashPaisa: BigInt(rs(15000)), expectedCashPaisa: BigInt(rs(15000)), differencePaisa: 0n } });
    ({ app } = await startApp(url!));
    api = client(`http://127.0.0.1:${app.getHttpServer().address().port}/api`);
    for (const [k, role] of [['owner', 'OWNER'], ['sales', 'SALESMAN'], ['store', 'STOREKEEPER'], ['acct', 'ACCOUNTANT']] as const) await api.login(k, a.phones[role]!);
    await api.login('other', b.phones.OWNER!);

    const { call } = api;
    id.pipe = (await call('POST', '/products', 'owner', { name: 'PVC Pipe 1 inch', purchasePricePaisa: rs(450), salePricePaisa: rs(650), minLevel: 15 })).json.id;
    id.fan = (await call('POST', '/products', 'owner', { name: 'Ceiling Fan 48 inch', purchasePricePaisa: rs(3850), salePricePaisa: rs(4800), minLevel: 4 })).json.id;
    id.supplier = (await call('POST', '/parties', 'owner', { name: 'Al-Madina', type: 'SUPPLIER' })).json.id;
    id.customer = (await call('POST', '/parties', 'owner', { name: 'Rana Builders', type: 'CUSTOMER', openingBalancePaisa: rs(10000) })).json.id;
    id.heads = (await call('GET', '/expense-heads', 'sales')).json;
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const head = (name: string) => id.heads.find((h: any) => h.name === name).id;

  test('a full day: sales by cash/bank/credit, expenses, wasooli, supplier payment (FR-CLS-01..03, BR-8, BR-9)', async () => {
    const { call } = api;
    // Purchase: 100 pipes @ 450 and 10 fans @ 3,850 = 83,500; Rs 5,000 paid to the supplier in cash
    const p = await call('POST', '/documents', 'store', { kind: 'PURCHASE', partyId: id.supplier, lines: [{ productId: id.pipe, qtyMilli: q(100), ratePaisa: rs(450) }, { productId: id.fan, qtyMilli: q(10), ratePaisa: rs(3850) }], payments: [{ mode: 'CASH', amountPaisa: rs(5000) }] });
    assert.equal(p.status, 201, JSON.stringify(p.json));
    // Sale 1: 10 pipes, cash 6,500 (COGS 4,500)
    await call('POST', '/documents', 'sales', { kind: 'SALE', lines: [{ productId: id.pipe, qtyMilli: q(10), ratePaisa: rs(650) }], payments: [{ mode: 'CASH', amountPaisa: rs(6500) }] });
    // Sale 2: 2 fans, JazzCash 9,600 (COGS 7,700)
    await call('POST', '/documents', 'sales', { kind: 'SALE', lines: [{ productId: id.fan, qtyMilli: q(2), ratePaisa: rs(4800) }], payments: [{ mode: 'JAZZCASH', amountPaisa: rs(9600) }] });
    // Sale 3: 20 pipes to Rana on credit, 3,000 cash now (COGS 9,000)
    await call('POST', '/documents', 'sales', { kind: 'SALE', partyId: id.customer, lines: [{ productId: id.pipe, qtyMilli: q(20), ratePaisa: rs(650) }], payments: [{ mode: 'CASH', amountPaisa: rs(3000) }] });
    // Sale 4: voided on the same day → left out of the day totals
    const s4 = await call('POST', '/documents', 'sales', { kind: 'SALE', lines: [{ productId: id.pipe, qtyMilli: q(1), ratePaisa: rs(650) }], payments: [{ mode: 'CASH', amountPaisa: rs(650) }] });
    assert.equal((await call('POST', `/documents/${s4.json.id}/void`, 'owner', { reason: 'typed by mistake' })).status, 201);
    // Expenses: tea 450 cash (salesman), labour 1,200 cash, transport 2,000 bank (owner)
    assert.equal((await call('POST', '/expenses', 'sales', { headId: head('Tea / food'), amountPaisa: rs(450), paidFrom: 'CASH' })).status, 201);
    assert.equal((await call('POST', '/expenses', 'sales', { headId: head('Labour'), amountPaisa: rs(1500), paidFrom: 'CASH' })).status, 403, 'above the salesman limit (FR-EXP-02)');
    assert.equal((await call('POST', '/expenses', 'sales', { headId: head('Labour'), amountPaisa: rs(100), paidFrom: 'BANK' })).status, 403, 'salesman: cash only');
    await call('POST', '/expenses', 'owner', { headId: head('Labour'), amountPaisa: rs(1200), paidFrom: 'CASH' });
    await call('POST', '/expenses', 'owner', { headId: head('Transport'), amountPaisa: rs(2000), paidFrom: 'BANK' });
    // Wasooli: Rana pays 8,000 cash of old udhaar; owner pays the supplier 20,000 by bank
    await call('POST', `/parties/${id.customer}/payments`, 'sales', { direction: 'RECEIVED', amountPaisa: rs(8000), mode: 'CASH' });
    await call('POST', `/parties/${id.supplier}/payments`, 'owner', { direction: 'PAID', amountPaisa: rs(20000), mode: 'BANK' });

    const d = await call('GET', '/day', 'owner');
    assert.equal(d.status, 200, JSON.stringify(d.json));
    const s = d.json.summary;
    assert.equal(s.openingCashPaisa, rs(15000));
    assert.equal(s.billCount, 3);
    assert.equal(s.saleTotalPaisa, rs(6500 + 9600 + 13000));
    assert.equal(s.salesCashPaisa, rs(9500));
    assert.equal(s.salesBankPaisa, rs(9600));
    assert.equal(s.salesCreditPaisa, rs(10000));
    assert.equal(s.cogsPaisa, rs(4500 + 7700 + 9000));
    assert.equal(s.grossProfitPaisa, rs(29100 - 21200));
    assert.equal(s.expensesTotalPaisa, rs(3650));
    assert.equal(s.netProfitPaisa, rs(7900 - 3650));
    assert.equal(s.purchasesPaisa, rs(83500));
    assert.equal(s.supplierPaidCashPaisa, rs(5000));
    assert.equal(s.supplierPaidBankPaisa, rs(20000));
    // 15,000 + 9,500 cash sales + 8,000 wasooli − 1,650 cash expenses − 5,000 cash to supplier
    assert.equal(s.expectedCashPaisa, rs(25850));
    assert.equal(d.json.expenses.length, 3);
    assert.equal((await call('GET', '/day', 'store')).status, 403, 'storekeeper cannot see the day screen');
  });

  test('dashboard (FR-DSH-01..03): salesman does not see stock value or profit', async () => {
    const o = (await api.call('GET', '/dashboard', 'owner')).json;
    assert.equal(o.salesTodayPaisa, rs(29100));
    assert.equal(o.salesTodayCount, 3);
    assert.equal(o.purchasesTodayPaisa, rs(83500));
    assert.equal(o.grossProfitTodayPaisa, rs(7900));
    assert.ok(o.stockValuePaisa > 0);
    const sm = (await api.call('GET', '/dashboard', 'sales')).json;
    assert.equal(sm.stockValuePaisa, null);
    assert.equal(sm.grossProfitTodayPaisa, null);
  });

  test('closing: big difference needs a note, then the day locks (FR-CLS-04..06, BR-10)', async () => {
    const { call } = api;
    assert.equal((await call('POST', '/day/close', 'sales', { countedCashPaisa: rs(25850) })).status, 403, 'salesman may not close unless allowed');
    const noNote = await call('POST', '/day/close', 'owner', { countedCashPaisa: rs(25000) });
    assert.equal(noNote.status, 422);
    assert.equal(noNote.json.code, 'NOTE_REQUIRED');
    const ok = await call('POST', '/day/close', 'owner', { countedCashPaisa: rs(25000), note: 'Rs 850 given as change, not noted' });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.differencePaisa, -rs(850));
    assert.equal(ok.json.nextOpeningCashPaisa, rs(25000));
    const locked = await call('POST', '/documents', 'sales', { kind: 'SALE', lines: [{ productId: id.pipe, qtyMilli: q(1), ratePaisa: rs(650) }], payments: [{ mode: 'CASH', amountPaisa: rs(650) }] });
    assert.equal(locked.status, 409);
    assert.equal(locked.json.code, 'DAY_CLOSED');
    assert.equal((await call('POST', '/expenses', 'owner', { headId: head('Tea / food'), amountPaisa: rs(100), paidFrom: 'CASH' })).json.code, 'DAY_CLOSED');
    assert.equal((await call('POST', '/day/close', 'owner', { countedCashPaisa: rs(25000) })).status, 409, 'already closed');
  });

  test('owner reopens with a reason, then closes again; both are audited (FR-CLS-05)', async () => {
    const { call } = api;
    assert.equal((await call('POST', '/day/reopen', 'sales', { date: today, reason: 'x x x' })).status, 403);
    assert.equal((await call('POST', '/day/reopen', 'owner', { date: today, reason: 'late sale to enter' })).status, 201);
    assert.equal((await call('POST', '/documents', 'sales', { kind: 'SALE', lines: [{ productId: id.pipe, qtyMilli: q(1), ratePaisa: rs(650) }], payments: [{ mode: 'CASH', amountPaisa: rs(650) }] })).status, 201);
    const again = await call('POST', '/day/close', 'owner', { countedCashPaisa: rs(26500) });
    assert.equal(again.status, 201, JSON.stringify(again.json));
    assert.equal(again.json.expectedCashPaisa, rs(26500));
    const audit = await db.auditLog.findMany({ where: { shopId: id.shop, action: { startsWith: 'day.' } }, orderBy: { at: 'asc' } });
    assert.deepEqual(audit.map((a) => a.action), ['day.close', 'day.reopen', 'day.reclose']);
  });

  test('monthly view: totals, expenses by head, best sellers (FR-CLS-09/10)', async () => {
    const m = await api.call('GET', `/day/month?month=${today.slice(0, 7)}`, 'acct');
    assert.equal(m.status, 200, JSON.stringify(m.json));
    assert.equal(m.json.salePaisa, rs(29100 + 650));
    assert.equal(m.json.expensesTotalPaisa, rs(3650));
    assert.equal(m.json.bestSelling[0].name, 'PVC Pipe 1 inch');
    assert.equal(m.json.bestSelling[0].qtyMilli, q(31));
    assert.equal((await api.call('GET', `/day/month?month=${today.slice(0, 7)}`, 'sales')).status, 403);
  });

  test('reports: stock ledger CSV and XLSX, valuation at a date, party balances (FR-RPT-01..05)', async () => {
    const { call } = api;
    const csv = await call('GET', '/reports/stock-ledger?format=csv', 'acct');
    assert.equal(csv.status, 200);
    const text = csv.bytes.toString('utf8');
    assert.ok(text.startsWith('﻿Date,Type,Doc no'), 'UTF-8 BOM and header');
    assert.match(text, /PURCHASE,PUR-000001,Al-Madina,P-00001,PVC Pipe 1 inch,100,pcs,450,45000,100,100,450/);
    const xl = await call('GET', '/reports/stock-ledger?format=xlsx', 'owner');
    assert.equal(xl.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xl.bytes as unknown as ArrayBuffer);
    assert.equal(wb.worksheets[0]!.getRow(1).getCell(1).value, 'Date');
    assert.ok(wb.worksheets[0]!.rowCount > 5);
    const val = (await call('GET', '/reports/stock-valuation', 'acct')).json;
    const total = val.rows.find((r: any) => r.name === 'TOTAL');
    const dash = (await call('GET', '/dashboard', 'owner')).json;
    assert.equal(total.value, dash.stockValuePaisa, 'valuation equals dashboard stock value (acceptance check 3)');
    const old = (await call('GET', '/reports/stock-valuation?date=2000-01-01', 'acct')).json;
    assert.equal(old.rows.find((r: any) => r.name === 'TOTAL').value, 0);
    const parties = (await call('GET', '/reports/party-balances', 'owner')).json.rows;
    assert.equal(parties.find((r: any) => r.name === 'Rana Builders').receivable, rs(10000 + 10000 - 8000));
    assert.equal(parties.find((r: any) => r.name === 'Al-Madina').payable, rs(83500 - 5000 - 20000));
    assert.equal((await call('GET', '/reports/stock-ledger?format=csv', 'sales')).status, 403);
  });

  test('users: owner adds, disables and resets; last owner is protected (FR-AUTH-04)', async () => {
    const { call, login } = api;
    assert.equal((await call('GET', '/users', 'sales')).status, 403);
    const u = await call('POST', '/users', 'owner', { name: 'New Salesman', phone: '0311 2223334', role: 'SALESMAN', password: 'counter-pass-9' });
    assert.equal(u.status, 201, JSON.stringify(u.json));
    await login('newbie', '03112223334', 'counter-pass-9');
    assert.equal((await call('GET', '/auth/me', 'newbie')).json.role, 'SALESMAN');
    await call('PATCH', `/users/${u.json.id}`, 'owner', { active: false });
    assert.equal((await call('POST', '/auth/login', null, { login: '03112223334', password: 'counter-pass-9' })).status, 401, 'disabled user cannot log in');
    await call('PATCH', `/users/${u.json.id}`, 'owner', { active: true });
    assert.equal((await call('POST', `/users/${u.json.id}/reset-password`, 'owner', { password: 'fresh-pass-77' })).status, 201);
    await login('newbie', '03112223334', 'fresh-pass-77');
    const owners = (await call('GET', '/users', 'owner')).json.filter((x: any) => x.role === 'OWNER');
    assert.equal((await call('PATCH', `/users/${owners[0].id}`, 'owner', { role: 'SALESMAN' })).status, 400);
  });

  test('settings: owner edits profile and defaults; receipt uses them (FR-SET-01/03)', async () => {
    const { call } = api;
    assert.equal((await call('PATCH', '/settings', 'sales', { name: 'X' })).status, 403);
    const s = await call('PATCH', '/settings', 'owner', { receiptFooter: 'Shukriya! Dobara tashreef layein', defaults: { salesmanMayCloseDay: true } });
    assert.equal(s.json.defaults.salesmanMayCloseDay, true);
    assert.equal(s.json.defaults.closingNoteLimitPaisa, rs(500), 'other defaults are kept');
    const day = (await call('GET', '/day', 'sales')).json;
    assert.equal(day.canClose, true);
  });

  test('one shop never sees or changes another shop\x27s data (FR-AUTH-03)', async () => {
    const { call } = api;
    const other = 'other';
    assert.equal((await call('GET', `/products/${id.pipe}`, other)).status, 404);
    assert.equal((await call('GET', '/products', other)).json.length, 0);
    assert.equal((await call('PATCH', `/products/${id.pipe}`, other, { salePricePaisa: 1 })).status, 404);
    assert.equal((await call('GET', `/parties/${id.customer}`, other)).status, 404);
    assert.equal((await call('POST', `/parties/${id.customer}/payments`, other, { direction: 'RECEIVED', amountPaisa: 100, mode: 'CASH' })).status, 404);
    const docs = (await call('GET', '/documents', 'owner')).json;
    assert.equal((await call('GET', `/documents/${docs[0].id}`, other)).status, 404);
    assert.equal((await call('POST', `/documents/${docs[0].id}/void`, other, { reason: 'steal it' })).status, 404);
    assert.equal((await call('GET', `/documents/${docs[0].id}/receipt`, other)).status, 404);
    const sell = await call('POST', '/documents', other, { kind: 'SALE', lines: [{ productId: id.pipe, qtyMilli: q(1), ratePaisa: 1 }], payments: [{ mode: 'CASH', amountPaisa: 1 }] });
    assert.equal(sell.status, 404, 'cannot sell another shop\x27s product');
    assert.equal((await call('GET', '/reports/stock-ledger', other)).json.rows.length, 0);
    assert.equal((await call('GET', '/day', other)).json.summary.saleTotalPaisa, 0);
    assert.equal((await call('GET', '/users', other)).json.every((u: any) => u.name.endsWith('Other Shop')), true);
  });
});
