/**
 * Product name matching (SRS FR-REV-04/05, FR-PRD-08, UML diagram 08).
 * Order: alias hit → exact product name → fuzzy (trigram + token match).
 * Size and number tokens on the bill must exist on the product ("Elbow 1"" never matches "Elbow ½ inch").
 */

const FRACTION_CHARS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75 };

function trimNumber(n: number): string {
  return String(Number(n.toFixed(3)));
}

/** Lower case, unify sizes and units, drop punctuation. Same function for bill text, product names and aliases. */
export function normalizeName(raw: string): string {
  let s = raw.toLowerCase();
  // 1½ → 1.5, ½ → 0.5 (before NFKC, which would turn ½ into 1⁄2)
  s = s.replace(/(\d+)\s*([½¼¾])/g, (_m, d: string, f: string) => trimNumber(Number(d) + (FRACTION_CHARS[f] ?? 0)));
  s = s.replace(/[½¼¾]/g, (f) => ` ${FRACTION_CHARS[f]}`);
  s = s.normalize('NFKC').replace(/⁄/g, '/');
  s = s.replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'");
  // 1/2" → 0.5" (only common pipe-size fractions written with an inch mark)
  s = s.replace(/\b(\d+)\/(2|4|8|16)\s*(?=("|''|inch|in(?![a-z])))/g, (_m, n: string, d: string) => trimNumber(Number(n) / Number(d)));
  s = s.replace(/\bhalf\b/g, '0.5').replace(/\bquarter\b/g, '0.25');
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:inches|inch|in(?![a-z])|''|")/g, '$1in ');
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:feet|foot|ft(?![a-z])|')/g, '$1ft ');
  s = s.replace(/(\d+(?:\.\d+)?)\s*mm(?![a-z])/g, '$1mm ');
  s = s.replace(/(\d+)\s*(?:pieces|piece|pcs|pc)(?![a-z])/g, '$1pcs ');
  // keep letters (incl. Urdu), digits, decimal points between digits and "/" codes like 7/29
  s = s.replace(/[^a-z0-9.\/؀-ۿ]+/g, ' ');
  s = s.replace(/(?<!\d)\.|\.(?!\d)/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

interface SizeToken {
  num: number;
  unit: string;
}

function sizeToken(t: string): SizeToken | null {
  const m = /^(\d+(?:\.\d+)?)([a-z]*)$/.exec(t);
  return m ? { num: Number(m[1]), unit: m[2] ?? '' } : null;
}

function isCode(t: string): boolean {
  return /\d/.test(t) && sizeToken(t) === null;
}

function trigrams(s: string): Map<string, number> {
  const p = `  ${s} `;
  const out = new Map<string, number>();
  for (let i = 0; i + 3 <= p.length; i++) {
    const g = p.slice(i, i + 3);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice similarity on character trigrams, 0..1 */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let common = 0;
  let na = 0;
  let nb = 0;
  for (const [g, c] of ta) {
    na += c;
    common += Math.min(c, tb.get(g) ?? 0);
  }
  for (const c of tb.values()) nb += c;
  return (2 * common) / (na + nb);
}

/** Every size/number token on the bill must be on the product (same number; unit equal or missing on one side). Codes like 7/29 must match exactly. */
function sizesCompatible(raw: string[], cand: string[]): boolean {
  const candSizes = cand.map(sizeToken).filter((x): x is SizeToken => x !== null);
  for (const t of raw) {
    const s = sizeToken(t);
    if (s) {
      const ok = candSizes.some((c) => c.num === s.num && (c.unit === s.unit || !c.unit || !s.unit));
      if (!ok) return false;
    } else if (isCode(t) && !cand.includes(t)) {
      return false;
    }
  }
  return true;
}

/** Similarity of two normalised names, 0..1. 0 when sizes do not fit. */
export function nameScore(rawNorm: string, candNorm: string): number {
  if (!rawNorm || !candNorm) return 0;
  if (rawNorm === candNorm) return 1;
  const a = rawNorm.split(' ');
  const b = candNorm.split(' ');
  if (!sizesCompatible(a, b)) return 0;
  const words = b.filter((t) => !/\d/.test(t));
  let sum = 0;
  for (const t of a) {
    if (/\d/.test(t)) {
      sum += 1; // already checked by sizesCompatible
      continue;
    }
    let best = 0;
    for (const w of words) best = Math.max(best, dice(t, w));
    sum += best;
  }
  const tokenScore = sum / a.length;
  const whole = dice([...a].sort().join(' '), [...b].sort().join(' '));
  return Math.round((0.7 * tokenScore + 0.3 * whole) * 1000) / 1000;
}

export interface CatalogProduct {
  id: string;
  name: string;
  /** normalizeName(name); computed if missing */
  normalized?: string;
}

export interface CatalogAlias {
  productId: string;
  text: string;
  normalized?: string;
  /** Alias learned from one supplier (FR-PRD-08) */
  partyId?: string | null;
}

export interface MatchOptions {
  partyId?: string | null;
  autoThreshold?: number;
  suggestThreshold?: number;
  minGap?: number;
}

export type MatchStatus = 'alias' | 'exact' | 'auto' | 'suggest' | 'new';

export interface MatchSuggestion {
  productId: string;
  score: number;
}

export interface MatchResult {
  status: MatchStatus;
  /** Set for alias, exact and auto */
  productId: string | null;
  score: number;
  normalized: string;
  /** Best three products by score (score > 0) */
  suggestions: MatchSuggestion[];
}

export function matchProduct(
  raw: string,
  products: readonly CatalogProduct[],
  aliases: readonly CatalogAlias[] = [],
  options: MatchOptions = {},
): MatchResult {
  const auto = options.autoThreshold ?? 0.85;
  const suggest = options.suggestThreshold ?? 0.6;
  const gap = options.minGap ?? 0.1;
  const n = normalizeName(raw);
  const none: MatchResult = { status: 'new', productId: null, score: 0, normalized: n, suggestions: [] };
  if (!n) return none;

  const aliasNorm = aliases.map((a) => ({ ...a, normalized: a.normalized ?? normalizeName(a.text) }));
  const hits = aliasNorm.filter((a) => a.normalized === n);
  if (hits.length) {
    const rank = (a: CatalogAlias) => (options.partyId && a.partyId === options.partyId ? 0 : a.partyId ? 2 : 1);
    const best = [...hits].sort((x, y) => rank(x) - rank(y))[0]!;
    return { status: 'alias', productId: best.productId, score: 1, normalized: n, suggestions: [{ productId: best.productId, score: 1 }] };
  }

  const prodNorm = products.map((p) => ({ id: p.id, normalized: p.normalized ?? normalizeName(p.name) }));
  const exact = prodNorm.find((p) => p.normalized === n);
  if (exact) return { status: 'exact', productId: exact.id, score: 1, normalized: n, suggestions: [{ productId: exact.id, score: 1 }] };

  const scores = new Map<string, number>();
  for (const p of prodNorm) scores.set(p.id, nameScore(n, p.normalized));
  for (const a of aliasNorm) {
    if (!scores.has(a.productId)) continue;
    scores.set(a.productId, Math.max(scores.get(a.productId) ?? 0, nameScore(n, a.normalized)));
  }
  const ranked = [...scores].map(([productId, score]) => ({ productId, score })).filter((x) => x.score > 0).sort((x, y) => y.score - x.score);
  const suggestions = ranked.slice(0, 3);
  const best = ranked[0];
  if (!best) return none;
  const second = ranked[1]?.score ?? 0;
  if (best.score >= auto && best.score - second >= gap) return { status: 'auto', productId: best.productId, score: best.score, normalized: n, suggestions };
  if (best.score >= suggest) return { status: 'suggest', productId: null, score: best.score, normalized: n, suggestions };
  return { ...none, score: best.score, suggestions };
}
