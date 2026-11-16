import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchProduct, nameScore, normalizeName } from '../src/matching.ts';

const catalog = [
  { id: 'pipe', name: 'PVC Pipe 1 inch – 10 ft' },
  { id: 'elbow1', name: 'Elbow Joint 1 inch' },
  { id: 'elbow05', name: 'Elbow Joint ½ inch' },
  { id: 'board', name: 'Switch Board 8-gang' },
  { id: 'ball05', name: 'Ball Valve ½ inch' },
  { id: 'gate1', name: 'Gate Valve 1 inch' },
  { id: 'tee075', name: 'Tee Joint ¾ inch' },
  { id: 'wire', name: 'Copper Wire 7/29 – coil' },
  { id: 'dinner', name: 'Dinner Set 24 pcs' },
];

test('normalisation unifies sizes and units', () => {
  assert.equal(normalizeName('Ball valve ½'), 'ball valve 0.5');
  assert.equal(normalizeName('Ball Valve ½ inch'), 'ball valve 0.5in');
  assert.equal(normalizeName('PVC pipe 1" 10ft'), 'pvc pipe 1in 10ft');
  assert.equal(normalizeName('PVC Pipe 1 inch – 10 ft'), 'pvc pipe 1in 10ft');
  assert.equal(normalizeName('Switch Board 8-gang'), 'switch board 8 gang');
  assert.equal(normalizeName('Dinner set 24pc'), 'dinner set 24pcs');
  assert.equal(normalizeName('Elbow 1/2"'), 'elbow 0.5in');
  assert.equal(normalizeName('Tee 1½ inch'), 'tee 1.5in');
});

test('bill text matches the right size', () => {
  for (const [raw, id, status] of [
    ['Elbow 1"', 'elbow1', 'auto'],
    ['8 gang board', 'board', 'auto'],
    ['Ball valve ½', 'ball05', 'auto'],
    ['PVC pipe 1"', 'pipe', 'auto'],
    ['Tee ¾', 'tee075', 'auto'],
    // normalises to the same text as the product name
    ['Gate valve 1"', 'gate1', 'exact'],
  ] as const) {
    const m = matchProduct(raw, catalog);
    assert.equal(m.status, status, `${raw}: ${JSON.stringify(m)}`);
    assert.equal(m.productId, id, raw);
  }
});

test('exact name and exact alias', () => {
  assert.equal(matchProduct('switch board 8 gang', catalog).status, 'exact');
  const m = matchProduct('7/29 taar', catalog, [{ productId: 'wire', text: '7/29 taar' }]);
  assert.deepEqual([m.status, m.productId], ['alias', 'wire']);
});

test('supplier-specific alias wins for that supplier (FR-PRD-08)', () => {
  const aliases = [
    { productId: 'elbow1', text: 'L 1', partyId: null },
    { productId: 'elbow05', text: 'L 1', partyId: 'al-madina' },
  ];
  assert.equal(matchProduct('L 1', catalog, aliases, { partyId: 'al-madina' }).productId, 'elbow05');
  assert.equal(matchProduct('L 1', catalog, aliases, { partyId: 'other' }).productId, 'elbow1');
});

test('a size that is not in the catalog never matches another size', () => {
  assert.equal(nameScore('elbow 1in', 'elbow joint 0.5in'), 0);
  const m = matchProduct('Ceiling fan 48"', catalog);
  assert.equal(m.status, 'new');
  assert.equal(m.productId, null);
});

test('typo gives suggestions, not an automatic match', () => {
  const m = matchProduct('elbo 1"', catalog);
  assert.equal(m.status, 'suggest');
  assert.equal(m.suggestions[0]?.productId, 'elbow1');
});

test('no size written and two sizes exist: user must pick', () => {
  const m = matchProduct('Elbow', catalog);
  assert.equal(m.status, 'suggest');
  assert.deepEqual(m.suggestions.slice(0, 2).map((s) => s.productId).sort(), ['elbow05', 'elbow1']);
});

test('code tokens like 7/29 must match exactly', () => {
  assert.equal(nameScore('copper wire 3/29', normalizeName('Copper Wire 7/29 – coil')), 0);
});
