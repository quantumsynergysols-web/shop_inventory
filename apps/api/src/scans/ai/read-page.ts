import sharp from 'sharp';
import type { AiProvider, PageExtraction, PageInput, ReadHints } from '../ai-provider.js';

/** FR-AI-12: pages with more rows than this are read again in overlapping horizontal strips. */
export const STRIP_THRESHOLD = 25;
const ROWS_PER_STRIP = 18;
const MAX_STRIPS = 6;
const OVERLAP = 0.08;
const MAX_SIDE = 2400;

type Usage = PageExtraction['usage'];
const addUsage = (a: Usage, b: Usage): Usage => ({ model: a.model, tokensIn: a.tokensIn + b.tokensIn, tokensOut: a.tokensOut + b.tokensOut, costMicroUsd: a.costMicroUsd + b.costMicroUsd, ms: a.ms + b.ms });

/** Upright JPEG no larger than MAX_SIDE (EXIF rotation applied; HEIC and others converted). */
export async function normalizePhoto(page: PageInput): Promise<PageInput & { width: number; height: number }> {
  const { data, info } = await sharp(page.bytes, { failOn: 'none' })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true });
  return { pageNo: page.pageNo, bytes: data, contentType: 'image/jpeg', width: info.width, height: info.height };
}

/**
 * Reads one page (FR-AI-01/02). When the first reading has more than STRIP_THRESHOLD rows, the page
 * is cut into overlapping horizontal strips read one by one (FR-AI-12), because models drop rows on
 * long lists. A row is kept from the strip whose own (non-overlapping) band holds its centre, so a
 * row seen by two strips counts once even without a serial number; checkExtraction (domain) then
 * also removes same-serial duplicates and finds serial gaps (FR-AI-13). Header and bill total come
 * from the whole-page reading.
 */
export async function readPage(ai: AiProvider, raw: PageInput, hints: ReadHints): Promise<PageExtraction & { strips: number }> {
  if (!ai.reads) return { ...(await ai.extract(raw, hints)), strips: 0 };
  const page = await normalizePhoto(raw);
  const whole = await ai.extract(page, hints);
  if (whole.lines.length <= STRIP_THRESHOLD) return { ...whole, strips: 0 };

  const count = Math.min(MAX_STRIPS, Math.max(2, Math.ceil(whole.lines.length / ROWS_PER_STRIP)));
  const band = page.height / count;
  const pad = Math.round(page.height * OVERLAP);
  const strips = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const top = Math.max(0, Math.round(i * band) - pad);
      const bottom = Math.min(page.height, Math.round((i + 1) * band) + pad);
      const bytes = await sharp(page.bytes).extract({ left: 0, top, width: page.width, height: bottom - top }).jpeg({ quality: 88 }).toBuffer();
      const r = await ai.extract({ pageNo: page.pageNo, bytes, contentType: 'image/jpeg' }, { ...hints, strip: { index: i, count } });
      const h = bottom - top;
      const own = { from: i * band, to: (i + 1) * band };
      const lines = r.lines
        .map((l) => (l.bbox ? { ...l, bbox: [l.bbox[0]!, (top + l.bbox[1]! * h) / page.height, l.bbox[2]!, (l.bbox[3]! * h) / page.height] } : l))
        .filter((l) => {
          if (!l.bbox) return true;
          const centre = (l.bbox[1]! + l.bbox[3]! / 2) * page.height;
          return centre >= own.from && (centre < own.to || i === count - 1);
        });
      return { lines, usage: r.usage };
    }),
  );
  const usage = strips.reduce((u, s) => addUsage(u, s.usage), whole.usage);
  return { ...whole, lines: strips.flatMap((s) => s.lines), usage, strips: count };
}
