import type { Paisa } from './money.ts';
import { mulDiv } from './money.ts';
import type { QtyMilli } from './qty.ts';
import type { StockState } from './costing.ts';
import { EMPTY_STOCK, applyIn, applyOut, unitCost, withLastCost } from './costing.ts';

/**
 * Posting documents to stock (SRS §3.5). Pure: takes the current stock of the
 * products involved and returns the movements and the new stock. The caller
 * writes both in one database transaction (FR-STK-01).
 */
export const IN_KINDS = ['PURCHASE', 'SALES_RETURN', 'ADJUST_IN', 'OPENING'] as const;
export const OUT_KINDS = ['SALE', 'PURCHASE_RETURN', 'ADJUST_OUT'] as const;
export type InKind = (typeof IN_KINDS)[number];
export type OutKind = (typeof OUT_KINDS)[number];
export type DocKind = InKind | OutKind;

export interface PostingLine {
  lineNo: number;
  productId: string;
  qtyBaseMilli: QtyMilli;
  /**
   * Cost per base unit. Required for PURCHASE and OPENING (the purchase rate) and for
   * SALES_RETURN (the cost recorded on the original sale). Optional for ADJUST_IN
   * (defaults to current average cost). Ignored for OUT kinds.
   */
  unitCostPaisa?: Paisa;
}

export interface Movement {
  lineNo: number;
  productId: string;
  type: 'IN' | 'OUT';
  /** Signed: + IN, - OUT */
  qtyMilli: QtyMilli;
  /** Signed change in stock value; for OUT this is minus the COGS */
  valuePaisa: Paisa;
  /** |value| ÷ qty per base unit, for display and the stock ledger */
  unitCostPaisa: Paisa;
  balanceAfterMilli: QtyMilli;
}

export interface Shortage {
  lineNo: number;
  productId: string;
  onHandMilli: QtyMilli;
  requestedMilli: QtyMilli;
}

export class StockShortageError extends Error {
  readonly shortages: readonly Shortage[];
  constructor(shortages: Shortage[]) {
    super(`not enough stock on line(s) ${shortages.map((s) => s.lineNo).join(', ')}`);
    this.name = 'StockShortageError';
    this.shortages = shortages;
  }
}

export interface PostingResult {
  movements: Movement[];
  /** New stock state for every product touched */
  stock: Map<string, StockState>;
  /** Σ cost of goods sold for SALE documents (BR-3), else 0 */
  cogsPaisa: Paisa;
}

export interface PostingOptions {
  /** Owner setting "allow negative stock" (FR-REV-07, FR-SET-03) */
  allowNegative?: boolean;
}

function isInKind(kind: DocKind): kind is InKind {
  return (IN_KINDS as readonly string[]).includes(kind);
}

function inCost(kind: InKind, line: PostingLine, s: StockState): Paisa {
  if (kind === 'ADJUST_IN' && line.unitCostPaisa === undefined) return unitCost(s);
  const c = line.unitCostPaisa;
  if (c === undefined || !Number.isSafeInteger(c) || c < 0) throw new RangeError(`line ${line.lineNo}: ${kind} needs a unit cost in whole paisa`);
  return c;
}

function movement(line: PostingLine, type: 'IN' | 'OUT', delta: Paisa, next: StockState): Movement {
  const qty = type === 'IN' ? line.qtyBaseMilli : -line.qtyBaseMilli;
  return {
    lineNo: line.lineNo,
    productId: line.productId,
    type,
    qtyMilli: qty,
    valuePaisa: delta,
    unitCostPaisa: mulDiv(Math.abs(delta), 1000, line.qtyBaseMilli),
    balanceAfterMilli: next.onHandMilli,
  };
}

/**
 * Posts one document. All-or-nothing: every shortage on the document is reported
 * together and the input stock map is never changed.
 */
export function postDocument(
  kind: DocKind,
  lines: readonly PostingLine[],
  stock: ReadonlyMap<string, StockState>,
  options: PostingOptions = {},
): PostingResult {
  if (lines.length === 0) throw new RangeError('a document needs at least one line');
  const next = new Map(stock);
  const movements: Movement[] = [];
  const shortages: Shortage[] = [];
  let cogs = 0;

  for (const line of lines) {
    const s = next.get(line.productId) ?? EMPTY_STOCK;
    if (isInKind(kind)) {
      const r = applyIn(s, line.qtyBaseMilli, inCost(kind, line, s));
      next.set(line.productId, r.next);
      movements.push(movement(line, 'IN', r.deltaPaisa, r.next));
      continue;
    }
    const short = line.qtyBaseMilli > s.onHandMilli && !options.allowNegative;
    if (short) shortages.push({ lineNo: line.lineNo, productId: line.productId, onHandMilli: s.onHandMilli, requestedMilli: line.qtyBaseMilli });
    // Keep simulating so later lines of the same product see the reduced stock; nothing is returned if any line is short.
    const r = applyOut(s, line.qtyBaseMilli, true);
    next.set(line.productId, r.next);
    movements.push(movement(line, 'OUT', r.deltaPaisa, r.next));
    if (kind === 'SALE') cogs += -r.deltaPaisa;
  }

  if (shortages.length) throw new StockShortageError(shortages);
  return { movements, stock: next, cogsPaisa: cogs };
}

/**
 * Void (BR-6): equal and opposite movements. The original document stays visible.
 * Reversing a purchase whose stock has already been sold would make stock negative,
 * so it is refused unless negative stock is allowed.
 */
export function reverseMovements(
  original: readonly Movement[],
  stock: ReadonlyMap<string, StockState>,
  options: PostingOptions = {},
): { movements: Movement[]; stock: Map<string, StockState> } {
  if (original.length === 0) throw new RangeError('nothing to reverse');
  const next = new Map(stock);
  const movements: Movement[] = [];
  const shortages: Shortage[] = [];

  for (const m of original) {
    const s = next.get(m.productId) ?? EMPTY_STOCK;
    const onHand = s.onHandMilli - m.qtyMilli;
    if (m.qtyMilli > 0 && onHand < 0 && !options.allowNegative) {
      shortages.push({ lineNo: m.lineNo, productId: m.productId, onHandMilli: s.onHandMilli, requestedMilli: m.qtyMilli });
    }
    const ns = withLastCost({ onHandMilli: onHand, valuePaisa: s.valuePaisa - m.valuePaisa, lastUnitCostPaisa: s.lastUnitCostPaisa });
    next.set(m.productId, ns);
    movements.push({ ...m, type: m.type === 'IN' ? 'OUT' : 'IN', qtyMilli: -m.qtyMilli, valuePaisa: -m.valuePaisa, balanceAfterMilli: onHand });
  }

  if (shortages.length) throw new StockShortageError(shortages);
  return { movements, stock: next };
}
