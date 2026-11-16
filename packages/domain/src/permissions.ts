import type { Paisa } from './money.ts';
import type { PayMode } from './dayClosing.ts';

/**
 * Permission matrix, SRS v1.1 §3.11. Rows marked * in the SRS are proposed defaults
 * awaiting owner confirmation; changing them only needs an edit to MATRIX.
 */
export type Role = 'OWNER' | 'SALESMAN' | 'STOREKEEPER' | 'ACCOUNTANT';

export type Action =
  | 'sale.create'
  | 'purchase.create'
  | 'stock.manual_in'
  | 'stock.manual_out'
  | 'return.sales'
  | 'return.purchase'
  | 'product.view'
  | 'product.edit'
  | 'price.edit'
  | 'document.void'
  | 'stock.adjust'
  | 'stock.import_opening'
  | 'party.view_customers'
  | 'party.view_suppliers'
  | 'payment.customer_receipt'
  | 'payment.supplier'
  | 'expense.create'
  | 'day.view'
  | 'day.close'
  | 'day.reopen'
  | 'dashboard.view'
  | 'dashboard.view_financials'
  | 'report.view'
  | 'report.export'
  | 'audit.view'
  | 'settings.manage';

const ALL: readonly Role[] = ['OWNER', 'SALESMAN', 'STOREKEEPER', 'ACCOUNTANT'];

const MATRIX: Record<Action, readonly Role[]> = {
  'sale.create': ['OWNER', 'SALESMAN'],
  'purchase.create': ['OWNER', 'STOREKEEPER'],
  'stock.manual_in': ['OWNER', 'STOREKEEPER'],
  'stock.manual_out': ['OWNER', 'SALESMAN'],
  'return.sales': ['OWNER', 'SALESMAN'],
  'return.purchase': ['OWNER', 'STOREKEEPER'],
  'product.view': ALL,
  'product.edit': ['OWNER'],
  'price.edit': ['OWNER'],
  'document.void': ['OWNER'],
  'stock.adjust': ['OWNER'],
  'stock.import_opening': ['OWNER'],
  'party.view_customers': ['OWNER', 'SALESMAN', 'ACCOUNTANT'],
  'party.view_suppliers': ['OWNER', 'STOREKEEPER', 'ACCOUNTANT'],
  'payment.customer_receipt': ['OWNER', 'SALESMAN'],
  'payment.supplier': ['OWNER'],
  // Salesman limits are checked in canAddExpense
  'expense.create': ['OWNER', 'SALESMAN'],
  'day.view': ['OWNER', 'SALESMAN', 'ACCOUNTANT'],
  // Salesman only when the owner allows it; checked in canCloseDay
  'day.close': ['OWNER', 'SALESMAN'],
  'day.reopen': ['OWNER'],
  'dashboard.view': ALL,
  'dashboard.view_financials': ['OWNER', 'ACCOUNTANT'],
  'report.view': ['OWNER', 'ACCOUNTANT'],
  'report.export': ['OWNER', 'ACCOUNTANT'],
  'audit.view': ['OWNER', 'ACCOUNTANT'],
  'settings.manage': ['OWNER'],
};

export interface ShopRules {
  /** FR-SET-03, default false */
  salesmanMayCloseDay?: boolean;
  /** FR-EXP-02, default Rs 1,000 */
  salesmanExpenseLimitPaisa?: Paisa;
}

export function can(role: Role, action: Action): boolean {
  return MATRIX[action].includes(role);
}

/** FR-EXP-02: salesman may add cash expenses only, up to the limit. */
export function canAddExpense(role: Role, expense: { amountPaisa: Paisa; paidFrom: PayMode }, rules: ShopRules = {}): boolean {
  if (!can(role, 'expense.create')) return false;
  if (role !== 'SALESMAN') return true;
  return expense.paidFrom === 'CASH' && expense.amountPaisa <= (rules.salesmanExpenseLimitPaisa ?? 100_000);
}

export function canCloseDay(role: Role, rules: ShopRules = {}): boolean {
  if (role === 'OWNER') return true;
  return role === 'SALESMAN' && rules.salesmanMayCloseDay === true;
}
