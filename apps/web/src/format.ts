/** Money arrives as whole paisa and quantities as thousandths (SRS C-4); numbers always in Western digits (NFR-USE-02). */
export const rs = (paisa: number | null | undefined): string => {
  if (paisa == null) return '—';
  const neg = paisa < 0;
  const a = Math.abs(paisa);
  const whole = Math.floor(a / 100);
  const frac = a % 100;
  return `${neg ? '−' : ''}Rs ${whole.toLocaleString('en-US')}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
};
export const num = (paisa: number | null | undefined) => rs(paisa).replace('Rs ', '');
export const qty = (milli: number | null | undefined): string => (milli == null ? '—' : String(Number((milli / 1000).toFixed(3))));

/** "1,250.50" → 125050; returns null for empty or invalid input */
export function toPaisa(v: string): number | null {
  const s = v.replace(/,/g, '').trim();
  if (!s) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [w = '0', f = ''] = s.split('.');
  return Number(w) * 100 + Number(f.padEnd(2, '0'));
}
export function toMilli(v: string): number | null {
  const s = v.replace(/,/g, '').trim();
  if (!s) return null;
  if (!/^\d+(\.\d{0,3})?$/.test(s)) return null;
  const [w = '0', f = ''] = s.split('.');
  return Number(w) * 1000 + Number(f.padEnd(3, '0'));
}
export const paisaInput = (p: number | null | undefined) => (p == null ? '' : String(p / 100));
export const milliInput = (m: number | null | undefined) => (m == null ? '' : String(m / 1000));
export const time = (d: string | Date) => new Date(d).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' });
export const date = (d: string | Date) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
