import type { Paisa } from './money.ts';
import { lineAmount, rupeesToPaisa } from './money.ts';
import type { QtyMilli } from './qty.ts';
import { toMilli } from './qty.ts';
import type { UnitCode } from './units.ts';
import { normalizeUnit } from './units.ts';
import { normalizeName } from './matching.ts';

/**
 * Deterministic checks on the Vision AI output (SRS FR-AI-04, FR-AI-12, FR-AI-13, NFR-ACC-02).
 * The AI result is never trusted as-is: rows can be dropped silently on long bills,
 * so serial numbers and totals are checked and every problem is shown on the review screen.
 */

/** One line in the AI extraction contract (SRS §5.4). Rupee amounts and quantities as numbers. */
export interface AiLine {
  /** Serial number written on the paper */
  line_no: number | null;
  raw_name: string;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  line_total: number | null;
  confidence: number;
  page: number;
  bbox?: number[];
}

export type LineFlag = 'LOW_CONFIDENCE' | 'AMOUNT_MISMATCH' | 'MISSING_QTY' | 'MISSING_RATE' | 'UNKNOWN_UNIT' | 'BAD_NUMBER' | 'DUPLICATE_SERIAL';
export type BillFlag = 'NO_LINES' | 'NO_BILL_TOTAL' | 'TOTAL_MISMATCH' | 'ROWS_MAY_BE_MISSING';

export interface CheckedLine {
  serialNo: number | null;
  page: number;
  rawName: string;
  qtyMilli: QtyMilli | null;
  unit: UnitCode | null;
  ratePaisa: Paisa | null;
  lineTotalPaisa: Paisa | null;
  /** Written line total, or qty × rate when no total was written */
  amountPaisa: Paisa | null;
  confidence: number;
  bbox?: number[];
  flags: LineFlag[];
}

export interface CheckResult {
  lines: CheckedLine[];
  flags: BillFlag[];
  linesTotalPaisa: Paisa;
  billTotalPaisa: Paisa | null;
  /** Serial numbers missing from the sequence on the paper */
  missingSerials: number[];
  /** Rows dropped because overlapping strips (FR-AI-12) returned the same row twice */
  overlapDuplicatesRemoved: number;
}

export interface CheckOptions {
  /** FR-REV-03 default 0.85 */
  confidenceThreshold?: number;
  /** Absolute tolerance for qty × rate and totals (default Rs 1) */
  tolerancePaisa?: Paisa;
  /** Relative tolerance (default 0.5 %) */
  toleranceRatio?: number;
}

const MAX_GAP_LISTED = 500;

function safe<T>(fn: () => T): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: fn() };
  } catch {
    return { ok: false };
  }
}

function sameRow(a: AiLine, b: AiLine): boolean {
  return normalizeName(a.raw_name) === normalizeName(b.raw_name) && a.qty === b.qty && a.line_total === b.line_total;
}

/** Removes the copy of a row that two overlapping strips both read; keeps the higher-confidence reading. */
function dedupeOverlaps(lines: readonly AiLine[]): { kept: AiLine[]; removed: number; clashes: Set<AiLine> } {
  const kept: AiLine[] = [];
  const clashes = new Set<AiLine>();
  let removed = 0;
  for (const line of lines) {
    if (line.line_no == null) {
      kept.push(line);
      continue;
    }
    const i = kept.findIndex((k) => k.page === line.page && k.line_no === line.line_no && sameRow(k, line));
    if (i >= 0) {
      removed++;
      if (line.confidence > kept[i]!.confidence) kept[i] = line;
      continue;
    }
    const clash = kept.find((k) => k.page === line.page && k.line_no === line.line_no);
    if (clash) {
      clashes.add(clash);
      clashes.add(line);
    }
    kept.push(line);
  }
  return { kept, removed, clashes };
}

/** Pages may continue the numbering (1–40, 41–80) or restart at 1 on each page; both are handled. */
export function findMissingSerials(lines: readonly { page: number; serialNo: number | null }[]): number[] {
  const pages = [...new Set(lines.map((l) => l.page))].sort((a, b) => a - b);
  const missing = new Set<number>();
  let prevLast = 0;
  for (const page of pages) {
    const serials = [...new Set(lines.filter((l) => l.page === page && l.serialNo != null).map((l) => l.serialNo!))].sort((a, b) => a - b);
    if (serials.length === 0) continue;
    let expected = serials[0] === 1 ? 1 : prevLast + 1;
    for (const n of serials) {
      for (let k = expected; k < n && k < expected + MAX_GAP_LISTED; k++) missing.add(k);
      expected = Math.max(expected, n + 1);
    }
    prevLast = serials[serials.length - 1]!;
  }
  return [...missing].sort((a, b) => a - b);
}

export function checkExtraction(input: readonly AiLine[], billTotal: number | null, options: CheckOptions = {}): CheckResult {
  const threshold = options.confidenceThreshold ?? 0.85;
  const tolAbs = options.tolerancePaisa ?? 100;
  const tolRatio = options.toleranceRatio ?? 0.005;
  const within = (a: Paisa, b: Paisa) => Math.abs(a - b) <= Math.max(tolAbs, Math.abs(b) * tolRatio);

  const ordered = [...input].sort((a, b) => a.page - b.page || (a.line_no ?? Number.MAX_SAFE_INTEGER) - (b.line_no ?? Number.MAX_SAFE_INTEGER));
  const { kept, removed, clashes } = dedupeOverlaps(ordered);

  const lines: CheckedLine[] = kept.map((l) => {
    const flags: LineFlag[] = [];
    const qty = l.qty == null ? null : safe(() => toMilli(l.qty!));
    const rate = l.rate == null ? null : safe(() => rupeesToPaisa(l.rate!));
    const total = l.line_total == null ? null : safe(() => rupeesToPaisa(l.line_total!));
    if ((qty && !qty.ok) || (rate && !rate.ok) || (total && !total.ok)) flags.push('BAD_NUMBER');
    const qtyMilli = qty?.ok ? qty.value : null;
    const ratePaisa = rate?.ok ? rate.value : null;
    const lineTotalPaisa = total?.ok ? total.value : null;
    const unit = normalizeUnit(l.unit);

    if (!(l.confidence >= threshold)) flags.push('LOW_CONFIDENCE');
    if (qtyMilli === null) flags.push('MISSING_QTY');
    if (ratePaisa === null && lineTotalPaisa === null) flags.push('MISSING_RATE');
    if (l.unit && l.unit.trim() && unit === null) flags.push('UNKNOWN_UNIT');
    if (clashes.has(l)) flags.push('DUPLICATE_SERIAL');

    let amountPaisa: Paisa | null = lineTotalPaisa;
    if (qtyMilli !== null && ratePaisa !== null) {
      const computed = lineAmount(qtyMilli, ratePaisa);
      if (lineTotalPaisa !== null && !within(computed, lineTotalPaisa)) flags.push('AMOUNT_MISMATCH');
      amountPaisa ??= computed;
    }
    const out: CheckedLine = {
      serialNo: l.line_no, page: l.page, rawName: l.raw_name.trim(), qtyMilli, unit, ratePaisa, lineTotalPaisa, amountPaisa, confidence: l.confidence, flags,
    };
    if (l.bbox) out.bbox = l.bbox;
    return out;
  });

  const flags: BillFlag[] = [];
  const linesTotalPaisa = lines.reduce((sum, l) => sum + (l.amountPaisa ?? 0), 0);
  const bt = billTotal == null ? null : safe(() => rupeesToPaisa(billTotal));
  const billTotalPaisa = bt?.ok ? bt.value : null;
  if (lines.length === 0) flags.push('NO_LINES');
  if (billTotalPaisa === null) flags.push('NO_BILL_TOTAL');
  else if (!within(linesTotalPaisa, billTotalPaisa)) flags.push('TOTAL_MISMATCH');
  const missingSerials = findMissingSerials(lines);
  if (missingSerials.length) flags.push('ROWS_MAY_BE_MISSING');

  return { lines, flags, linesTotalPaisa, billTotalPaisa, missingSerials, overlapDuplicatesRemoved: removed };
}

/** FR-REV-14: flagged rows first (lowest confidence first), then the rest in paper order. Does not change the input. */
export function reviewOrder(lines: readonly CheckedLine[]): CheckedLine[] {
  return lines
    .map((l, i) => ({ l, i, flagged: l.flags.length > 0 }))
    .sort((a, b) => {
      if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
      if (a.flagged && a.l.confidence !== b.l.confidence) return a.l.confidence - b.l.confidence;
      return a.i - b.i;
    })
    .map((x) => x.l);
}
