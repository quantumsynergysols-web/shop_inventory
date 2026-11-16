import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRs, lineAmount, mulDiv, rupeesToPaisa } from '../src/money.ts';
import { toMilli } from '../src/qty.ts';

test('rupee amounts as written on bills', () => {
  assert.equal(rupeesToPaisa('1,250.5'), 125050);
  assert.equal(rupeesToPaisa('Rs 450/-'), 45000);
  assert.equal(rupeesToPaisa('146200'), 14620000);
  assert.equal(rupeesToPaisa(0.1 + 0.2), 30);
  assert.throws(() => rupeesToPaisa('12.345'), RangeError);
  assert.throws(() => rupeesToPaisa('abc'), RangeError);
});

test('quantities keep three decimals exactly', () => {
  assert.equal(toMilli('1.5'), 1500);
  assert.equal(toMilli(12), 12000);
  assert.equal(toMilli(0.1 + 0.2), 300);
  assert.throws(() => toMilli('1.2345'), RangeError);
});

test('mulDiv rounds half away from zero and is exact for large values', () => {
  assert.equal(mulDiv(5, 1, 2), 3);
  assert.equal(mulDiv(-5, 1, 2), -3);
  assert.equal(mulDiv(4, 1, 3), 1);
  // Rs 10 crore of stock × 20,000 units ÷ 30,000 units: beyond float-safe products
  assert.equal(mulDiv(10_000_000_000, 20_000_000, 30_000_000), 6_666_666_667);
});

test('line amount: 1.5 m at Rs 450 = Rs 675', () => {
  assert.equal(lineAmount(1500, 45000), 67500);
});

test('format', () => {
  assert.equal(formatRs(12345678), 'Rs 123,456.78');
  assert.equal(formatRs(45000), 'Rs 450');
  assert.equal(formatRs(-50), '-Rs 0.50');
});
