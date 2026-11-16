import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_STOCK, InsufficientStockError, applyIn, applyOut, unitCost } from '../src/costing.ts';

const rs = (n: number) => n * 100;
const q = (n: number) => n * 1000;

test('BR-2 weighted average after two purchases', () => {
  const a = applyIn(EMPTY_STOCK, q(20), rs(450)).next;
  const b = applyIn(a, q(50), rs(470)).next;
  assert.equal(b.onHandMilli, q(70));
  assert.equal(b.valuePaisa, rs(9000 + 23500));
  // 32,500 ÷ 70 = 464.2857… → 46,429 paisa
  assert.equal(unitCost(b), 46429);
});

test('BR-3 COGS at average cost; selling everything leaves exactly zero value', () => {
  let s = applyIn(EMPTY_STOCK, q(20), rs(450)).next;
  s = applyIn(s, q(50), rs(470)).next;
  let cogs = 0;
  for (const sold of [10, 7, 13, 25, 15]) {
    const r = applyOut(s, q(sold));
    cogs += -r.deltaPaisa;
    s = r.next;
  }
  assert.equal(s.onHandMilli, 0);
  assert.equal(s.valuePaisa, 0);
  assert.equal(cogs, rs(32500), 'no paisa lost or created by rounding');
});

test('sale above stock is refused unless negative stock is allowed', () => {
  const s = applyIn(EMPTY_STOCK, q(5), rs(100)).next;
  assert.throws(() => applyOut(s, q(8)), InsufficientStockError);
  const r = applyOut(s, q(8), true);
  assert.equal(-r.deltaPaisa, rs(800));
  assert.equal(r.next.onHandMilli, q(-3));
  assert.equal(r.next.valuePaisa, rs(-300));
});

test('purchase after negative stock re-prices what remains at the new cost', () => {
  let s = applyIn(EMPTY_STOCK, q(5), rs(100)).next;
  s = applyOut(s, q(8), true).next;
  s = applyIn(s, q(10), rs(120)).next;
  assert.equal(s.onHandMilli, q(7));
  assert.equal(s.valuePaisa, rs(840));
  assert.equal(unitCost(s), rs(120));
});

test('sale with no stock at all uses the last known cost', () => {
  let s = applyIn(EMPTY_STOCK, q(2), rs(300)).next;
  s = applyOut(s, q(2)).next;
  const r = applyOut(s, q(1), true);
  assert.equal(-r.deltaPaisa, rs(300));
});

test('rejects bad input', () => {
  assert.throws(() => applyIn(EMPTY_STOCK, 0, 100), RangeError);
  assert.throws(() => applyIn(EMPTY_STOCK, 1000, 1.5), RangeError);
  assert.throws(() => applyOut(EMPTY_STOCK, -1000, true), RangeError);
});
