import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StockState } from '../src/costing.ts';
import { StockShortageError, postDocument, reverseMovements } from '../src/posting.ts';

const rs = (n: number) => n * 100;
const q = (n: number) => n * 1000;

function opening(): Map<string, StockState> {
  return postDocument('PURCHASE', [
    { lineNo: 1, productId: 'pipe', qtyBaseMilli: q(70), unitCostPaisa: rs(450) },
    { lineNo: 2, productId: 'tee', qtyBaseMilli: q(45), unitCostPaisa: rs(30) },
    { lineNo: 3, productId: 'fan', qtyBaseMilli: q(12), unitCostPaisa: rs(3850) },
  ], new Map()).stock;
}

test('purchase posts one IN movement per line with running balance', () => {
  const r = postDocument('PURCHASE', [
    { lineNo: 1, productId: 'pipe', qtyBaseMilli: q(20), unitCostPaisa: rs(450) },
    { lineNo: 2, productId: 'pipe', qtyBaseMilli: q(50), unitCostPaisa: rs(470) },
  ], new Map());
  assert.equal(r.movements.length, 2);
  assert.deepEqual(r.movements.map((m) => m.balanceAfterMilli), [q(20), q(70)]);
  assert.deepEqual(r.movements.map((m) => m.type), ['IN', 'IN']);
  assert.equal(r.cogsPaisa, 0);
});

test('sale: every short line is reported together and nothing changes (FR-STK-01, FR-REV-07)', () => {
  const stock = opening();
  const before = structuredClone(stock);
  assert.throws(
    () => postDocument('SALE', [
      { lineNo: 1, productId: 'pipe', qtyBaseMilli: q(10) },
      { lineNo: 5, productId: 'tee', qtyBaseMilli: q(60) },
      { lineNo: 6, productId: 'valve', qtyBaseMilli: q(4) },
    ], stock),
    (e: unknown) => {
      assert.ok(e instanceof StockShortageError);
      assert.deepEqual(e.shortages.map((s) => s.lineNo), [5, 6]);
      return true;
    },
  );
  assert.deepEqual(stock, before);
});

test('two lines of the same product: the second sees the first', () => {
  const stock = opening();
  assert.throws(() => postDocument('SALE', [
    { lineNo: 1, productId: 'fan', qtyBaseMilli: q(8) },
    { lineNo: 2, productId: 'fan', qtyBaseMilli: q(8) },
  ], stock), StockShortageError);
});

test('sale COGS and remaining stock', () => {
  const r = postDocument('SALE', [
    { lineNo: 1, productId: 'pipe', qtyBaseMilli: q(10) },
    { lineNo: 2, productId: 'fan', qtyBaseMilli: q(2) },
  ], opening());
  assert.equal(r.cogsPaisa, rs(4500 + 7700));
  assert.equal(r.stock.get('pipe')?.onHandMilli, q(60));
  assert.equal(r.movements[1]?.unitCostPaisa, rs(3850));
});

test('void a sale restores stock exactly (BR-6)', () => {
  const stock = opening();
  const sale = postDocument('SALE', [{ lineNo: 1, productId: 'pipe', qtyBaseMilli: q(7) }], stock);
  const voided = reverseMovements(sale.movements, sale.stock);
  assert.deepEqual(voided.stock.get('pipe'), stock.get('pipe'));
  assert.equal(voided.movements[0]?.type, 'IN');
  assert.equal(voided.movements[0]?.valuePaisa, -sale.movements[0]!.valuePaisa);
});

test('void a purchase whose stock was sold is refused unless negative stock is allowed', () => {
  const buy = postDocument('PURCHASE', [{ lineNo: 1, productId: 'fan', qtyBaseMilli: q(5), unitCostPaisa: rs(4000) }], new Map());
  const sale = postDocument('SALE', [{ lineNo: 1, productId: 'fan', qtyBaseMilli: q(3) }], buy.stock);
  assert.throws(() => reverseMovements(buy.movements, sale.stock), StockShortageError);
  const forced = reverseMovements(buy.movements, sale.stock, { allowNegative: true });
  assert.equal(forced.stock.get('fan')?.onHandMilli, q(-3));
});

test('sales return goes back in at the original cost; it needs that cost', () => {
  const stock = opening();
  assert.throws(() => postDocument('SALES_RETURN', [{ lineNo: 1, productId: 'pipe', qtyBaseMilli: q(2) }], stock), RangeError);
  const r = postDocument('SALES_RETURN', [{ lineNo: 1, productId: 'pipe', qtyBaseMilli: q(2), unitCostPaisa: rs(450) }], stock);
  assert.equal(r.stock.get('pipe')?.onHandMilli, q(72));
});

test('adjustment in defaults to current average cost', () => {
  const r = postDocument('ADJUST_IN', [{ lineNo: 1, productId: 'tee', qtyBaseMilli: q(5) }], opening());
  assert.equal(r.movements[0]?.unitCostPaisa, rs(30));
});

test('empty document is refused', () => {
  assert.throws(() => postDocument('SALE', [], new Map()), RangeError);
});
