/**
 * NFR-SEC-02: row-level security. Queries that forget the shopId filter still see only their shop.
 * Run with: npm run test:db --workspace @erp/api
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { client, makeShop, resetDb, startApp, testConfig } from '../test-support/db-app.js';
import { PrismaService } from './prisma.service.js';
import { shopContext } from './shop-context.js';

const url = process.env.TEST_DATABASE_URL;

describe('row-level security against PostgreSQL', { skip: !url && 'TEST_DATABASE_URL not set (run npm run test:db)' }, () => {
  let raw: PrismaClient;
  let db: PrismaService;
  const id: Record<string, string> = {};
  const phones: Record<string, string> = {};

  before(async () => {
    raw = new PrismaClient({ datasources: { db: { url: url! } } });
    await resetDb(raw);
    for (const [k, name, prefix] of [['a', 'Shop A', '0340'], ['b', 'Shop B', '0350']] as const) {
      const { shop, phones: ph } = await makeShop(raw, name, prefix);
      phones[k] = ph.OWNER!;
      id[k] = shop.id;
      const p = await raw.product.create({ data: { shopId: shop.id, sku: `P-${k}`, name: `Pipe ${k}`, normalizedName: `pipe ${k}`, aliases: { create: { text: `pipe-${k}`, normalized: `pipe ${k}` } } } });
      id[`p${k}`] = p.id;
    }
    db = new PrismaService(testConfig(url!));
  });

  after(async () => {
    await db?.$disconnect();
    await raw?.$disconnect();
  });

  // Prisma queries start when awaited, so await inside the context, as request handlers do
  const asShop = <T>(shop: string, f: () => PromiseLike<T>) => shopContext.run({ shopId: shop }, async () => await f());

  test('reads without a shop filter see only the current shop', async () => {
    assert.equal((await db.product.findMany()).length, 2, 'no shop context: login, seed and setup see all rows');
    const a = await asShop(id.a!, () => db.product.findMany());
    assert.deepEqual(a.map((p) => p.name), ['Pipe a']);
    assert.equal(await asShop(id.a!, () => db.product.findUnique({ where: { id: id.pb! } })), null);
    assert.equal(await asShop(id.a!, () => db.shop.count()), 1);
    assert.equal(await asShop(id.a!, () => db.party.count()), 1, 'only its own Walk-in');
    const rows = await asShop(id.a!, () => db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "product_alias"`);
    assert.equal(Number(rows[0]!.n), 1, 'raw SQL and child tables (via their product) too');
  });

  test('writes into another shop are refused, also inside transactions', async () => {
    await assert.rejects(asShop(id.a!, () => db.product.create({ data: { shopId: id.b!, sku: 'X', name: 'Sneaky', normalizedName: 'sneaky' } })), /row-level security/);
    const changed = await asShop(id.a!, () => db.product.updateMany({ data: { name: 'renamed' } }));
    assert.equal(changed.count, 1);
    assert.equal((await raw.product.findUniqueOrThrow({ where: { id: id.pb! } })).name, 'Pipe b', 'shop B untouched');
    const inTx = await asShop(id.b!, () =>
      db.$transaction(async (tx) => {
        const seen = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "product" FOR UPDATE`;
        return { seen: seen.length, a: await tx.product.findUnique({ where: { id: id.pa! } }) };
      }),
    );
    assert.deepEqual(inTx, { seen: 1, a: null });
    await assert.rejects(asShop(id.b!, () => db.$transaction(async (tx) => tx.docLine.create({ data: { documentId: '00000000-0000-0000-0000-000000000000', lineNo: 1, productId: id.pa!, qty: 1, unit: 'pcs', qtyBase: 1, ratePaisa: 0n, amountPaisa: 0n } }))));
  });

  test('API requests run their queries as their own shop', async () => {
    const { app, base } = await startApp(url!);
    const seen = new Set<string>();
    const orig = shopContext.getStore.bind(shopContext);
    shopContext.getStore = () => {
      const s = orig();
      if (s?.shopId) seen.add(s.shopId);
      return s;
    };
    try {
      const api = client(base);
      await api.login('a', phones.a!);
      const r = await api.call('GET', '/products', 'a');
      assert.deepEqual(r.json.map((p: any) => p.id), [id.pa]);
      assert.equal((await api.call('GET', '/dashboard', 'a')).status, 200);
      assert.deepEqual([...seen], [id.a], 'every query of the request was scoped to shop A');
    } finally {
      shopContext.getStore = orig;
      await app.close();
    }
  });

  test('the setting does not leak to the next query on the same connection', async () => {
    await asShop(id.a!, () => db.product.findMany());
    assert.equal((await db.product.findMany()).length, 2);
  });
});
