/**
 * FR-CLS-04: the cash already in the galla when a shop starts is its opening cash until the first
 * day is closed; after that, each day opens with the previous counted cash.
 * Run with: npm run test:db --workspace @erp/api
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { client, makeShop, resetDb, startApp } from '../test-support/db-app.js';

const url = process.env.TEST_DATABASE_URL;
const rs = (n: number) => n * 100;

describe('starting cash for a new shop against PostgreSQL', { skip: !url && 'TEST_DATABASE_URL not set (run npm run test:db)' }, () => {
  let app: INestApplication;
  let db: PrismaClient;
  let api: ReturnType<typeof client>;
  const id: Record<string, string> = {};

  before(async () => {
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    await resetDb(db);
    const a = await makeShop(db, 'New Shop', '0390');
    ({ app } = await startApp(url!));
    api = client(`http://127.0.0.1:${app.getHttpServer().address().port}/api`);
    await api.login('owner', a.phones.OWNER!);
    await api.login('sales', a.phones.SALESMAN!);
    const { call } = api;
    id.pipe = (await call('POST', '/products', 'owner', { name: 'PVC Pipe', purchasePricePaisa: rs(450), salePricePaisa: rs(650) })).json.id;
    id.sup = (await call('POST', '/parties', 'owner', { name: 'Supplier', type: 'SUPPLIER' })).json.id;
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  test('a new shop starts at Rs 0; only the owner sets the starting cash, and it becomes the opening cash', async () => {
    const { call } = api;
    const d0 = (await call('GET', '/day', 'owner')).json;
    assert.equal(d0.summary.openingCashPaisa, 0);
    assert.equal(d0.canSetStartingCash, true);
    assert.equal((await call('GET', '/day', 'sales')).json.canSetStartingCash, false);
    assert.equal((await call('POST', '/day/starting-cash', 'sales', { amountPaisa: rs(5000) })).status, 403);

    // paying the supplier Rs 3,000 cash on day one no longer makes the galla negative
    await call('POST', '/documents', 'owner', { kind: 'PURCHASE', partyId: id.sup, lines: [{ productId: id.pipe, qtyMilli: 10_000, ratePaisa: rs(450) }], payments: [{ mode: 'CASH', amountPaisa: rs(3000) }] });
    assert.equal((await call('GET', '/day', 'owner')).json.summary.expectedCashPaisa, -rs(3000));
    assert.equal((await call('POST', '/day/starting-cash', 'owner', { amountPaisa: rs(5000) })).status, 201);
    const d1 = (await call('GET', '/day', 'owner')).json;
    assert.equal(d1.summary.openingCashPaisa, rs(5000));
    assert.equal(d1.summary.expectedCashPaisa, rs(2000));
    assert.equal(d1.startingCashPaisa, rs(5000));
    assert.ok(await db.auditLog.findFirst({ where: { action: 'day.starting_cash' } }), 'the change is in the audit log');
    // other settings are kept
    assert.equal((await call('GET', '/settings', 'owner')).json.defaults.startingCashPaisa, rs(5000));
  });

  test('dates are calendar days whatever the database time zone (desktop PostgreSQL runs on Pakistan time)', async () => {
    const { call } = api;
    // only today's bills: today is not "a past day left open"
    assert.equal((await call('GET', '/dashboard', 'owner')).json.unclosedDay, null);
    // an expense on the 1st of the month counts in that month
    const today = (await call('GET', '/day', 'owner')).json.date as string;
    const first = `${today.slice(0, 7)}-01`;
    const shop = await db.shop.findFirstOrThrow({ where: { name: 'New Shop' }, include: { expenseHeads: true, users: { where: { role: 'OWNER' } } } });
    await db.expense.create({ data: { shopId: shop.id, businessDate: new Date(`${first}T00:00:00Z`), headId: shop.expenseHeads[0]!.id, amountPaisa: 12_300n, paidFrom: 'CASH', userId: shop.users[0]!.id } });
    const month = (await call('GET', `/day/month?month=${today.slice(0, 7)}`, 'owner')).json;
    assert.equal(month.expensesTotalPaisa, 12_300, 'the 1st of the month is inside the month');
    await db.expense.deleteMany({ where: { shopId: shop.id, amountPaisa: 12_300n } });
  });

  test('after the first closing the starting cash is fixed; the counted cash carries forward', async () => {
    const { call } = api;
    assert.equal((await call('POST', '/day/close', 'owner', { countedCashPaisa: rs(2000) })).status, 201);
    assert.equal((await call('GET', '/day', 'owner')).json.canSetStartingCash, false);
    assert.equal((await call('POST', '/day/starting-cash', 'owner', { amountPaisa: rs(9000) })).status, 409);
  });
});
