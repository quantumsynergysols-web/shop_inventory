import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AiLine } from '../src/extraction.ts';
import { checkExtraction, findMissingSerials, reviewOrder } from '../src/extraction.ts';

function line(n: number, page = 1, extra: Partial<AiLine> = {}): AiLine {
  return { line_no: n, raw_name: `Item ${n}`, qty: 2, unit: 'pcs', rate: 50, line_total: 100, confidence: 0.97, page, ...extra };
}

test('clean bill: no flags', () => {
  const r = checkExtraction([line(1), line(2), line(3)], 300);
  assert.deepEqual(r.flags, []);
  assert.equal(r.linesTotalPaisa, 30000);
  assert.ok(r.lines.every((l) => l.flags.length === 0));
});

test('100-line bill on 3 pages with row 47 silently dropped (FR-AI-13)', () => {
  const lines: AiLine[] = [];
  for (let n = 1; n <= 100; n++) {
    if (n === 47) continue;
    lines.push(line(n, n <= 40 ? 1 : n <= 80 ? 2 : 3));
  }
  const r = checkExtraction(lines, 10000);
  assert.deepEqual(r.missingSerials, [47]);
  assert.ok(r.flags.includes('ROWS_MAY_BE_MISSING'));
  assert.ok(r.flags.includes('TOTAL_MISMATCH'));
});

test('numbering that restarts on each page is not a gap', () => {
  assert.deepEqual(findMissingSerials([
    { page: 1, serialNo: 1 }, { page: 1, serialNo: 2 },
    { page: 2, serialNo: 1 }, { page: 2, serialNo: 2 },
  ]), []);
  assert.deepEqual(findMissingSerials([{ page: 1, serialNo: 3 }]), [1, 2]);
});

test('overlapping strips read the same row twice: one copy kept, higher confidence wins (FR-AI-12)', () => {
  const r = checkExtraction([line(1), line(2, 1, { confidence: 0.7 }), line(2, 1, { confidence: 0.95 }), line(3)], 300);
  assert.equal(r.lines.length, 3);
  assert.equal(r.overlapDuplicatesRemoved, 1);
  assert.equal(r.lines[1]?.confidence, 0.95);
  assert.deepEqual(r.flags, []);
});

test('same serial with different content is kept twice and flagged, never dropped', () => {
  const r = checkExtraction([line(1), line(2), line(2, 1, { raw_name: 'Other item' })], 300);
  assert.equal(r.lines.length, 3);
  assert.deepEqual(r.lines.filter((l) => l.flags.includes('DUPLICATE_SERIAL')).length, 2);
});

test('line flags: qty × rate mismatch, low confidence, missing values, unknown unit', () => {
  const r = checkExtraction([
    line(1, 1, { qty: 3, rate: 50, line_total: 100 }),
    line(2, 1, { confidence: 0.6 }),
    line(3, 1, { qty: null }),
    line(4, 1, { rate: null, line_total: null }),
    line(5, 1, { unit: 'gaddi' }),
  ], null);
  const f = r.lines.map((l) => l.flags);
  assert.deepEqual(f[0], ['AMOUNT_MISMATCH']);
  assert.deepEqual(f[1], ['LOW_CONFIDENCE']);
  assert.deepEqual(f[2], ['MISSING_QTY']);
  assert.deepEqual(f[3], ['MISSING_RATE']);
  assert.deepEqual(f[4], ['UNKNOWN_UNIT']);
  assert.ok(r.flags.includes('NO_BILL_TOTAL'));
});

test('rounding within Rs 1 is accepted', () => {
  const r = checkExtraction([line(1, 1, { qty: 3, rate: 33.33, line_total: 100 })], 100);
  assert.deepEqual(r.lines[0]?.flags, []);
  assert.deepEqual(r.flags, []);
});

test('no total written: amount is qty × rate', () => {
  const r = checkExtraction([line(1, 1, { line_total: null, qty: 1.5, unit: 'mtr', rate: 450 })], 675);
  assert.equal(r.lines[0]?.amountPaisa, 67500);
  assert.equal(r.lines[0]?.unit, 'metre');
});

test('review order puts flagged, least confident rows first', () => {
  const r = checkExtraction([line(1), line(2, 1, { confidence: 0.8 }), line(3), line(4, 1, { confidence: 0.5 })], 400);
  assert.deepEqual(reviewOrder(r.lines).map((l) => l.serialNo), [4, 2, 1, 3]);
});

test('empty result', () => {
  assert.deepEqual(checkExtraction([], 100).flags, ['NO_LINES', 'TOTAL_MISMATCH']);
});
