/**
 * Money is whole paisa (SRS C-4): Rs 1 = 100 paisa. No floating point is stored.
 */
export type Paisa = number;

export function assertPaisa(value: number, label = 'amount'): Paisa {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be whole paisa, got ${value}`);
  return value;
}

/**
 * a × b ÷ c, rounded half away from zero. Exact for any safe integers
 * (uses BigInt, so large stock values never lose precision).
 */
export function mulDiv(a: number, b: number, c: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(c)) {
    throw new RangeError(`mulDiv needs whole numbers, got ${a}, ${b}, ${c}`);
  }
  if (c === 0) throw new RangeError('mulDiv by zero');
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  let q = an / ad;
  if ((an % ad) * 2n >= ad) q += 1n;
  const result = Number(negative ? -q : q);
  if (!Number.isSafeInteger(result)) throw new RangeError('mulDiv result is too large');
  return result;
}

/** Parse a rupee amount as written or read by AI: "1,250.50", "Rs 450/-", 450, 12.5 */
export function rupeesToPaisa(input: string | number): Paisa {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new RangeError(`not a rupee amount: ${input}`);
    const p = Math.round(input * 100);
    if (Math.abs(input * 100 - p) > 1e-6) throw new RangeError(`more than 2 decimals: ${input}`);
    return assertPaisa(p === 0 ? 0 : p);
  }
  const s = input.trim().replace(/,/g, '').replace(/^rs\.?\s*/i, '').replace(/\/-$/, '').trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new RangeError(`not a rupee amount: ${input}`);
  const negative = s.startsWith('-');
  const [whole = '0', frac = ''] = s.replace('-', '').split('.');
  const p = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return assertPaisa(negative ? -p : p);
}

/** "Rs 123,456.78"; whole rupees are shown without decimals: "Rs 450" */
export function formatRs(p: Paisa): string {
  assertPaisa(p);
  const a = Math.abs(p);
  const whole = Math.floor(a / 100);
  const frac = a % 100;
  return `${p < 0 ? '-' : ''}Rs ${whole.toLocaleString('en-US')}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
}

/** Amount for qty (thousandths of a unit) at rate (paisa per unit). */
export function lineAmount(qtyMilli: number, ratePaisa: Paisa): Paisa {
  return mulDiv(qtyMilli, ratePaisa, 1000);
}
