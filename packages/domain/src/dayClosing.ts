import type { Paisa } from './money.ts';
import { assertPaisa } from './money.ts';

/**
 * Daily closing, expenses and profit (SRS §3.10a, BR-8, BR-9, BR-10).
 */
export type PayMode = 'CASH' | 'BANK' | 'JAZZCASH' | 'EASYPAISA';

export interface MoneyEntry {
  amountPaisa: Paisa;
  mode: PayMode;
}

export interface SaleBill {
  /** After discount */
  totalPaisa: Paisa;
  /** Amounts received now; the rest is udhaar (credit) */
  paid: readonly MoneyEntry[];
  /** Σ COGS of the bill's OUT movements (from postDocument) */
  cogsPaisa: Paisa;
}

export interface SalesReturnEntry {
  totalPaisa: Paisa;
  /** Money handed back; a return that only reduces the customer's balance has none */
  refunds: readonly MoneyEntry[];
  /** Cost put back into stock (value of the return's IN movements) */
  cogsReversedPaisa: Paisa;
}

export interface DayInput {
  openingCashPaisa: Paisa;
  sales: readonly SaleBill[];
  salesReturns?: readonly SalesReturnEntry[];
  expenses?: readonly MoneyEntry[];
  /** Wasooli: old udhaar received from customers today */
  customerPayments?: readonly MoneyEntry[];
  supplierPayments?: readonly MoneyEntry[];
  /** Stock IN value of today's purchases (shown, not part of profit) */
  purchasesPaisa?: Paisa;
}

export interface DaySummary {
  openingCashPaisa: Paisa;
  billCount: number;
  /** Σ sale bills − sales returns */
  saleTotalPaisa: Paisa;
  salesCashPaisa: Paisa;
  /** Bank, JazzCash, Easypaisa */
  salesBankPaisa: Paisa;
  /** Udhaar diya */
  salesCreditPaisa: Paisa;
  salesReturnsPaisa: Paisa;
  cogsPaisa: Paisa;
  grossProfitPaisa: Paisa;
  /** Gross profit ÷ sale × 100, one decimal; 0 when there is no sale */
  marginPct: number;
  expensesTotalPaisa: Paisa;
  expensesCashPaisa: Paisa;
  netProfitPaisa: Paisa;
  purchasesPaisa: Paisa;
  wasooliCashPaisa: Paisa;
  wasooliBankPaisa: Paisa;
  supplierPaidCashPaisa: Paisa;
  supplierPaidBankPaisa: Paisa;
  cashRefundsPaisa: Paisa;
  /** BR-8 */
  expectedCashPaisa: Paisa;
}

const sum = (xs: readonly MoneyEntry[] | undefined, pick: (e: MoneyEntry) => boolean = () => true): Paisa =>
  (xs ?? []).filter(pick).reduce((s, e) => s + assertPaisa(e.amountPaisa), 0);
const isCash = (e: MoneyEntry) => e.mode === 'CASH';
const notCash = (e: MoneyEntry) => e.mode !== 'CASH';

export function summarizeDay(d: DayInput): DaySummary {
  let gross = 0;
  let cash = 0;
  let bank = 0;
  let credit = 0;
  let cogs = 0;
  for (const [i, bill] of d.sales.entries()) {
    const paid = sum(bill.paid);
    if (paid > bill.totalPaisa) throw new RangeError(`sale ${i + 1}: paid ${paid} is more than the bill total ${bill.totalPaisa}; record change as not received`);
    gross += assertPaisa(bill.totalPaisa);
    cash += sum(bill.paid, isCash);
    bank += sum(bill.paid, notCash);
    credit += bill.totalPaisa - paid;
    cogs += assertPaisa(bill.cogsPaisa);
  }
  let returns = 0;
  let refundsCash = 0;
  for (const r of d.salesReturns ?? []) {
    returns += assertPaisa(r.totalPaisa);
    refundsCash += sum(r.refunds, isCash);
    cogs -= assertPaisa(r.cogsReversedPaisa);
  }
  const saleTotal = gross - returns;
  const grossProfit = saleTotal - cogs;
  const expensesTotal = sum(d.expenses);
  const expensesCash = sum(d.expenses, isCash);
  const wasooliCash = sum(d.customerPayments, isCash);
  const supplierCash = sum(d.supplierPayments, isCash);
  const expected = d.openingCashPaisa + cash + wasooliCash - expensesCash - supplierCash - refundsCash;

  return {
    openingCashPaisa: d.openingCashPaisa,
    billCount: d.sales.length,
    saleTotalPaisa: saleTotal,
    salesCashPaisa: cash,
    salesBankPaisa: bank,
    salesCreditPaisa: credit,
    salesReturnsPaisa: returns,
    cogsPaisa: cogs,
    grossProfitPaisa: grossProfit,
    marginPct: saleTotal > 0 ? Math.round((grossProfit * 1000) / saleTotal) / 10 : 0,
    expensesTotalPaisa: expensesTotal,
    expensesCashPaisa: expensesCash,
    netProfitPaisa: grossProfit - expensesTotal,
    purchasesPaisa: d.purchasesPaisa ?? 0,
    wasooliCashPaisa: wasooliCash,
    wasooliBankPaisa: sum(d.customerPayments, notCash),
    supplierPaidCashPaisa: supplierCash,
    supplierPaidBankPaisa: sum(d.supplierPayments, notCash),
    cashRefundsPaisa: refundsCash,
    expectedCashPaisa: expected,
  };
}

export class NoteRequiredError extends Error {
  readonly differencePaisa: Paisa;
  constructor(differencePaisa: Paisa) {
    super(`cash difference of ${differencePaisa / 100} rupees needs a note before closing`);
    this.name = 'NoteRequiredError';
    this.differencePaisa = differencePaisa;
  }
}

export interface ClosingResult {
  status: 'CLOSED';
  expectedCashPaisa: Paisa;
  countedCashPaisa: Paisa;
  /** Counted − expected: negative = short, positive = excess */
  differencePaisa: Paisa;
  note: string | null;
  /** FR-CLS-04: counted cash becomes tomorrow's opening cash */
  nextOpeningCashPaisa: Paisa;
}

/** FR-CLS-04, FR-CLS-06 (default note limit Rs 500). */
export function closeDay(summary: DaySummary, countedCashPaisa: Paisa, options: { note?: string; noteLimitPaisa?: Paisa } = {}): ClosingResult {
  assertPaisa(countedCashPaisa, 'counted cash');
  if (countedCashPaisa < 0) throw new RangeError('counted cash cannot be negative');
  const limit = options.noteLimitPaisa ?? 50_000;
  const difference = countedCashPaisa - summary.expectedCashPaisa;
  const note = options.note?.trim() || null;
  if (Math.abs(difference) > limit && !note) throw new NoteRequiredError(difference);
  return {
    status: 'CLOSED',
    expectedCashPaisa: summary.expectedCashPaisa,
    countedCashPaisa,
    differencePaisa: difference,
    note,
    nextOpeningCashPaisa: countedCashPaisa,
  };
}

export class DayClosedError extends Error {
  readonly businessDate: string;
  constructor(businessDate: string) {
    super(`${businessDate} is closed; only the owner can reopen it`);
    this.name = 'DayClosedError';
    this.businessDate = businessDate;
  }
}

/** BR-10 / FR-CLS-05: no new or changed document may be dated on a closed day. Dates are YYYY-MM-DD in the shop's time zone. */
export function assertDayOpen(businessDate: string, closedDates: ReadonlySet<string>): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new RangeError(`business date must be YYYY-MM-DD, got ${businessDate}`);
  if (closedDates.has(businessDate)) throw new DayClosedError(businessDate);
}
