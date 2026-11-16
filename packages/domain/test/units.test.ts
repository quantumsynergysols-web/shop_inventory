import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UnknownUnitError, normalizeUnit, toBaseQty } from '../src/units.ts';

test('unit spellings map to the master list', () => {
  assert.equal(normalizeUnit('Dz'), 'dozen');
  assert.equal(normalizeUnit('PCS.'), 'pcs');
  assert.equal(normalizeUnit('mtr'), 'metre');
  assert.equal(normalizeUnit('عدد'), 'pcs');
  assert.equal(normalizeUnit('darjan'), 'dozen');
  assert.equal(normalizeUnit(''), null);
  assert.equal(normalizeUnit(null), null);
  assert.equal(normalizeUnit('xyz'), null);
});

test('conversion to base unit', () => {
  assert.equal(toBaseQty(2000, 'dozen', { baseUnit: 'pcs' }), 24000);
  assert.equal(toBaseQty(3000, 'box', { baseUnit: 'pcs', conversions: [{ unit: 'box', factorToBase: 10 }] }), 30000);
  assert.equal(toBaseQty(5000, null, { baseUnit: 'pcs' }), 5000);
  assert.throws(() => toBaseQty(1000, 'box', { baseUnit: 'pcs' }), UnknownUnitError);
});
