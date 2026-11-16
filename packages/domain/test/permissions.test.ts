import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, canAddExpense, canCloseDay } from '../src/permissions.ts';

test('matrix basics', () => {
  assert.ok(can('SALESMAN', 'sale.create'));
  assert.ok(!can('SALESMAN', 'purchase.create'));
  assert.ok(can('STOREKEEPER', 'return.purchase'));
  assert.ok(!can('SALESMAN', 'document.void'));
  assert.ok(!can('ACCOUNTANT', 'sale.create'));
  assert.ok(can('ACCOUNTANT', 'report.export'));
  assert.ok(!can('SALESMAN', 'dashboard.view_financials'));
  assert.ok(can('OWNER', 'day.reopen'));
});

test('salesman expenses: cash only, up to the limit (FR-EXP-02)', () => {
  assert.ok(canAddExpense('SALESMAN', { amountPaisa: 30000, paidFrom: 'CASH' }));
  assert.ok(!canAddExpense('SALESMAN', { amountPaisa: 30000, paidFrom: 'BANK' }));
  assert.ok(!canAddExpense('SALESMAN', { amountPaisa: 150000, paidFrom: 'CASH' }));
  assert.ok(canAddExpense('SALESMAN', { amountPaisa: 150000, paidFrom: 'CASH' }, { salesmanExpenseLimitPaisa: 200000 }));
  assert.ok(canAddExpense('OWNER', { amountPaisa: 9_999_900, paidFrom: 'BANK' }));
  assert.ok(!canAddExpense('STOREKEEPER', { amountPaisa: 100, paidFrom: 'CASH' }));
});

test('closing the day: owner always, salesman only when allowed', () => {
  assert.ok(canCloseDay('OWNER'));
  assert.ok(!canCloseDay('SALESMAN'));
  assert.ok(canCloseDay('SALESMAN', { salesmanMayCloseDay: true }));
  assert.ok(!canCloseDay('ACCOUNTANT', { salesmanMayCloseDay: true }));
});
