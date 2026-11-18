import { z } from 'zod';
import type { PageExtraction } from '../ai-provider.js';

/**
 * The extraction contract (SRS §5.4, FR-AI-01/02/12) as one prompt and one JSON schema, shared by
 * every Vision AI provider. Numbers come back as written on the paper; checkExtraction (domain)
 * converts and checks them, so nothing here is trusted.
 */
export function prompt(hints: { docType: 'purchase' | 'sale'; knownProducts: string[] }, strip?: { index: number; count: number }): string {
  const who = hints.docType === 'purchase' ? 'a supplier bill (goods bought by the shop)' : 'a sale bill (goods sold by the shop)';
  return [
    `You read photos of handwritten or printed shop bills from Pakistan. This photo is ${who} for a sanitary, electrical, plumbing, crockery and hardware shop.`,
    'Writing may be Urdu (Nastaliq), Roman Urdu or English, often mixed, with abbreviations and local spellings.',
    strip
      ? `This image is horizontal strip ${strip.index + 1} of ${strip.count} of one page; strips overlap a little. Read every row that is fully visible in this strip, even if it may also appear in the next strip.`
      : 'Read every item row on the page, top to bottom.',
    'Rules:',
    '- One entry in "lines" per item row. Never invent rows, never merge two rows, never skip a row because it is hard to read.',
    '- line_no: the serial/row number written on the paper for that row (null if none is written).',
    '- raw_name: the item name exactly as written (keep the original script and spelling; do not translate).',
    '- qty, rate, line_total: the numbers as written (rupees for money). null when not written or unreadable. Do not calculate missing numbers.',
    '- unit: as written (e.g. pcs, dozen, box, ft, m, kg, roll, set, packet), or null.',
    '- confidence: 0 to 1, how sure you are of this whole row. Use below 0.6 for rows you had to guess.',
    '- bbox: [x, y, width, height] of the row on this image, each from 0 to 1 (top-left origin).',
    '- party_name, bill_no, date (YYYY-MM-DD if possible) from the bill header; bill_total is the grand total written on the bill. null when absent.',
    hints.knownProducts.length
      ? `Names this shop often uses (prefer these readings when the handwriting fits, but write what is on the paper): ${hints.knownProducts.slice(0, 200).join('; ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const nullable = (type: string) => ({ type: [type, 'null'] });

/** JSON Schema for OpenAI structured outputs (strict: every key required, nulls allowed). */
export const OPENAI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['party_name', 'bill_no', 'date', 'bill_total', 'lines'],
  properties: {
    party_name: nullable('string'),
    bill_no: nullable('string'),
    date: nullable('string'),
    bill_total: nullable('number'),
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['line_no', 'raw_name', 'qty', 'unit', 'rate', 'line_total', 'confidence', 'bbox'],
        properties: {
          line_no: nullable('integer'),
          raw_name: { type: 'string' },
          qty: nullable('number'),
          unit: nullable('string'),
          rate: nullable('number'),
          line_total: nullable('number'),
          confidence: { type: 'number' },
          bbox: { type: 'array', items: { type: 'number' } },
        },
      },
    },
  },
} as const;

/** The same schema in Gemini's OpenAPI subset (nullable flag, no additionalProperties). */
export const GEMINI_SCHEMA = {
  type: 'OBJECT',
  required: ['lines'],
  properties: {
    party_name: { type: 'STRING', nullable: true },
    bill_no: { type: 'STRING', nullable: true },
    date: { type: 'STRING', nullable: true },
    bill_total: { type: 'NUMBER', nullable: true },
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['raw_name', 'confidence'],
        properties: {
          line_no: { type: 'INTEGER', nullable: true },
          raw_name: { type: 'STRING' },
          qty: { type: 'NUMBER', nullable: true },
          unit: { type: 'STRING', nullable: true },
          rate: { type: 'NUMBER', nullable: true },
          line_total: { type: 'NUMBER', nullable: true },
          confidence: { type: 'NUMBER' },
          bbox: { type: 'ARRAY', items: { type: 'NUMBER' } },
        },
      },
    },
  },
} as const;

const num = z.number().finite().nullable().optional().transform((v) => v ?? null);
const str = z.string().nullable().optional().transform((v) => (v?.trim() ? v.trim() : null));
const answer = z.object({
  party_name: str,
  bill_no: str,
  date: str,
  bill_total: num,
  lines: z.array(
    z.object({
      line_no: z.number().int().nullable().optional().transform((v) => v ?? null),
      raw_name: z.string().default(''),
      qty: num,
      unit: str,
      rate: num,
      line_total: num,
      confidence: z.number().finite().default(0).transform((c) => Math.min(1, Math.max(0, c))),
      bbox: z.array(z.number()).optional(),
    }),
  ),
});

export class AiAnswerError extends Error {}

/** Parses the model's JSON text into the contract; a broken answer fails the page (FR-AI-07). */
export function parseAnswer(text: string): Omit<PageExtraction, 'usage'> {
  let json: unknown;
  try {
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  } catch {
    throw new AiAnswerError('The AI answer was not valid JSON');
  }
  const r = answer.safeParse(json);
  if (!r.success) throw new AiAnswerError(`The AI answer did not match the bill format: ${r.error.issues[0]?.message ?? ''}`);
  const a = r.data;
  return {
    partyName: a.party_name,
    billNo: a.bill_no,
    date: a.date,
    billTotal: a.bill_total,
    lines: a.lines
      .filter((l) => l.raw_name.trim() || l.qty != null || l.line_total != null)
      .map((l) => ({
        line_no: l.line_no,
        raw_name: l.raw_name.trim(),
        qty: l.qty,
        unit: l.unit,
        rate: l.rate,
        line_total: l.line_total,
        confidence: l.confidence,
        ...(l.bbox?.length === 4 && l.bbox.every((v) => v >= 0 && v <= 1.01) ? { bbox: l.bbox } : {}),
      })),
  };
}

/** FR-AI-09: cost in millionths of a dollar from a price per million tokens. */
export const costMicroUsd = (tokensIn: number, tokensOut: number, priceIn: number, priceOut: number) => Math.round(tokensIn * priceIn + tokensOut * priceOut);
