/**
 * Quantities are whole thousandths of the product's base unit: 1.5 metre = 1500, 12 pcs = 12000.
 * This keeps stock arithmetic exact (no float drift) while allowing metres, kg and feet.
 */
export type QtyMilli = number;

export function toMilli(input: number | string): QtyMilli {
  let m: number;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new RangeError(`not a quantity: ${input}`);
    m = Math.round(input * 1000);
    if (Math.abs(input * 1000 - m) > 1e-6) throw new RangeError(`quantity has more than 3 decimals: ${input}`);
  } else {
    const s = input.trim().replace(/,/g, '');
    if (!/^-?\d+(\.\d{1,3})?$/.test(s)) throw new RangeError(`not a quantity (max 3 decimals): ${input}`);
    const negative = s.startsWith('-');
    const [whole = '0', frac = ''] = s.replace('-', '').split('.');
    m = Number(whole) * 1000 + Number(frac.padEnd(3, '0'));
    if (negative) m = -m;
  }
  if (!Number.isSafeInteger(m)) throw new RangeError(`quantity too large: ${input}`);
  return m === 0 ? 0 : m;
}

export function fromMilli(m: QtyMilli): number {
  return m / 1000;
}
