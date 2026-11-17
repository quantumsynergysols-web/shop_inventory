import { Prisma } from '@prisma/client';
import { toMilli, type Paisa, type QtyMilli } from '@erp/domain';

/** DB BigInt paisa → domain number (money columns stay far below 2^53 paisa). */
export function paisa(v: bigint | number | null | undefined): Paisa {
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`amount out of range: ${v}`);
  return n;
}

export function big(p: Paisa): bigint {
  return BigInt(p);
}

/** DB Decimal(14,3) quantity → thousandths of the base unit */
export function milli(v: Prisma.Decimal | string | number | null | undefined): QtyMilli {
  if (v == null) return 0;
  return toMilli(typeof v === 'object' ? v.toFixed(3) : String(v));
}

/** thousandths → DB Decimal(14,3) */
export function dec(m: QtyMilli): Prisma.Decimal {
  const a = Math.abs(m);
  return new Prisma.Decimal(`${m < 0 ? '-' : ''}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, '0')}`);
}

/** The shop's business day as YYYY-MM-DD (Pakistan time). */
export function businessDate(d: Date = new Date(), timeZone = 'Asia/Karachi'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** YYYY-MM-DD → Date at UTC midnight, for @db.Date columns */
export function dateOnly(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new RangeError(`bad date ${ymd}`);
  return new Date(`${ymd}T00:00:00Z`);
}
