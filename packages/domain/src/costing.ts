import type { Paisa } from './money.ts';
import { lineAmount, mulDiv } from './money.ts';
import type { QtyMilli } from './qty.ts';

/**
 * Weighted average (moving average) costing, SRS FR-STK-03, BR-2, BR-3.
 *
 * The state keeps the total value of stock on hand instead of an average price.
 * Average cost = valuePaisa / onHand. Selling the last unit takes exactly the
 * remaining value, so rounding never piles up over time.
 */
export interface StockState {
  onHandMilli: QtyMilli;
  /** Value of the stock on hand at weighted average cost */
  valuePaisa: Paisa;
  /** Average cost per base unit the last time stock was above zero; prices sales made while stock is at or below zero */
  lastUnitCostPaisa: Paisa;
}

export const EMPTY_STOCK: StockState = Object.freeze({ onHandMilli: 0, valuePaisa: 0, lastUnitCostPaisa: 0 });

export interface CostResult {
  next: StockState;
  /** Signed change in stock value. For an OUT this is minus the cost of goods sold. */
  deltaPaisa: Paisa;
}

export class InsufficientStockError extends Error {
  readonly onHandMilli: QtyMilli;
  readonly requestedMilli: QtyMilli;
  constructor(onHandMilli: QtyMilli, requestedMilli: QtyMilli) {
    super(`not enough stock: ${onHandMilli / 1000} on hand, ${requestedMilli / 1000} requested`);
    this.name = 'InsufficientStockError';
    this.onHandMilli = onHandMilli;
    this.requestedMilli = requestedMilli;
  }
}

/** Average cost per base unit in paisa, rounded. Falls back to the last known cost when stock is zero or negative. */
export function unitCost(s: StockState): Paisa {
  return s.onHandMilli > 0 ? mulDiv(s.valuePaisa, 1000, s.onHandMilli) : s.lastUnitCostPaisa;
}

/** Refreshes lastUnitCostPaisa when stock is positive. */
export function withLastCost(s: StockState): StockState {
  return s.onHandMilli > 0 ? { ...s, lastUnitCostPaisa: unitCost(s) } : s;
}

function assertQty(q: QtyMilli): void {
  if (!Number.isSafeInteger(q) || q <= 0) throw new RangeError(`quantity must be a positive whole number of thousandths, got ${q}`);
}

/**
 * Stock IN at a given cost per base unit (BR-2):
 * new avg = (old qty × old avg + in qty × in rate) ÷ (old qty + in qty).
 * If stock was zero or negative, what remains is valued at the incoming cost.
 */
export function applyIn(s: StockState, qtyMilli: QtyMilli, unitCostPaisa: Paisa): CostResult {
  assertQty(qtyMilli);
  if (!Number.isSafeInteger(unitCostPaisa) || unitCostPaisa < 0) throw new RangeError(`unit cost must be whole paisa >= 0, got ${unitCostPaisa}`);
  const onHand = s.onHandMilli + qtyMilli;
  const value = s.onHandMilli > 0 ? s.valuePaisa + lineAmount(qtyMilli, unitCostPaisa) : lineAmount(onHand, unitCostPaisa);
  const next = withLastCost({ onHandMilli: onHand, valuePaisa: value, lastUnitCostPaisa: onHand > 0 ? s.lastUnitCostPaisa : unitCostPaisa });
  return { next, deltaPaisa: value - s.valuePaisa };
}

/**
 * Stock OUT at weighted average cost (BR-3). Throws InsufficientStockError when the
 * quantity is more than stock on hand, unless negative stock is allowed (FR-REV-07).
 */
export function applyOut(s: StockState, qtyMilli: QtyMilli, allowNegative = false): CostResult {
  assertQty(qtyMilli);
  if (qtyMilli > s.onHandMilli && !allowNegative) throw new InsufficientStockError(s.onHandMilli, qtyMilli);
  let cogs: Paisa;
  if (s.onHandMilli > 0 && qtyMilli <= s.onHandMilli) {
    cogs = qtyMilli === s.onHandMilli ? s.valuePaisa : mulDiv(s.valuePaisa, qtyMilli, s.onHandMilli);
  } else if (s.onHandMilli > 0) {
    // Sells everything on hand, then the rest at the current average cost.
    cogs = s.valuePaisa + mulDiv(qtyMilli - s.onHandMilli, s.valuePaisa, s.onHandMilli);
  } else {
    cogs = lineAmount(qtyMilli, s.lastUnitCostPaisa);
  }
  const lastUnitCostPaisa = unitCost(s);
  const next = withLastCost({ onHandMilli: s.onHandMilli - qtyMilli, valuePaisa: s.valuePaisa - cogs, lastUnitCostPaisa });
  return { next, deltaPaisa: -cogs };
}
