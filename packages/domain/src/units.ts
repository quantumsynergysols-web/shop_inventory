import type { QtyMilli } from './qty.ts';

/** Master unit list (FR-AI-05). */
export const MASTER_UNITS = ['pcs', 'box', 'dozen', 'metre', 'foot', 'kg', 'set', 'roll', 'packet'] as const;
export type UnitCode = (typeof MASTER_UNITS)[number];

/** Spellings seen on Pakistani bills (English, Roman Urdu, Urdu) mapped to the master list. */
const ALIASES: Record<string, UnitCode> = {
  pc: 'pcs', piece: 'pcs', pieces: 'pcs', nos: 'pcs', no: 'pcs', nr: 'pcs', adad: 'pcs', 'عدد': 'pcs', 'نگ': 'pcs',
  dz: 'dozen', dzn: 'dozen', doz: 'dozen', dozens: 'dozen', darjan: 'dozen', 'درجن': 'dozen',
  m: 'metre', mtr: 'metre', mtrs: 'metre', meter: 'metre', meters: 'metre', metres: 'metre', 'میٹر': 'metre',
  ft: 'foot', feet: 'foot', fts: 'foot', 'فٹ': 'foot',
  kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', 'کلو': 'kg',
  bx: 'box', boxes: 'box', dabba: 'box', dibba: 'box', 'ڈبہ': 'box',
  sets: 'set', 'سیٹ': 'set',
  rolls: 'roll', rl: 'roll',
  pkt: 'packet', pkts: 'packet', pack: 'packet', packs: 'packet', packets: 'packet', 'پیکٹ': 'packet',
};

/** Returns the master unit code, or null when the unit is blank or not recognised (the review screen flags it). */
export function normalizeUnit(raw: string | null | undefined): UnitCode | null {
  if (raw == null) return null;
  const key = raw.trim().toLowerCase().replace(/[.\s]+/g, '');
  if (!key) return null;
  if ((MASTER_UNITS as readonly string[]).includes(key)) return key as UnitCode;
  return ALIASES[key] ?? null;
}

export interface ProductUnits {
  baseUnit: UnitCode;
  /** e.g. { unit: 'box', factorToBase: 10 } means 1 box = 10 base units (FR-STK-10) */
  conversions?: readonly { unit: UnitCode; factorToBase: number }[];
}

export class UnknownUnitError extends Error {
  readonly unit: string;
  readonly baseUnit: string;
  constructor(unit: string, baseUnit: string) {
    super(`no conversion from ${unit} to ${baseUnit}`);
    this.name = 'UnknownUnitError';
    this.unit = unit;
    this.baseUnit = baseUnit;
  }
}

/** Converts a quantity in `unit` to the product's base unit. Stock is always kept in the base unit. */
export function toBaseQty(qtyMilli: QtyMilli, unit: UnitCode | null, product: ProductUnits): QtyMilli {
  if (unit === null || unit === product.baseUnit) return qtyMilli;
  let factor = product.conversions?.find((c) => c.unit === unit)?.factorToBase;
  if (factor === undefined && unit === 'dozen' && product.baseUnit === 'pcs') factor = 12;
  if (factor === undefined) throw new UnknownUnitError(unit, product.baseUnit);
  if (!(factor > 0) || !Number.isFinite(factor)) throw new RangeError(`bad conversion factor for ${unit}: ${factor}`);
  return Math.round(qtyMilli * factor);
}
