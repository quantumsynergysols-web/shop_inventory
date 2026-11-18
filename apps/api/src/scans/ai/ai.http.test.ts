/**
 * The OpenAI and Gemini readers, long-page strips and key encryption, against a local fake AI server.
 * No database and no real AI key needed.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { AiProvider, PageExtraction, PageInput, ReadHints } from '../ai-provider.js';
import { bill, startFakeAi } from '../../test-support/fake-ai.js';
import { parseAnswer } from './contract.js';
import { decryptKey, encryptKey } from './key-crypto.js';
import { readPage, STRIP_THRESHOLD } from './read-page.js';
import { GeminiVision, OpenAiVision, type VisionOptions } from './vision-providers.js';

const photo = async (w = 800, h = 600): Promise<PageInput> => ({ pageNo: 1, bytes: await sharp({ create: { width: w, height: h, channels: 3, background: '#fff' } }).png().toBuffer(), contentType: 'image/png' });
const hints = { docType: 'purchase' as const, knownProducts: ['PVC Pipe 1 inch', 'Elbow 1 inch'] };

describe('Vision AI readers', () => {
  let fake: Awaited<ReturnType<typeof startFakeAi>>;
  const opts = (o: Partial<VisionOptions> = {}): VisionOptions => ({ apiKey: 'sk-test-key-1234567890', model: 'm-1', baseUrl: fake.base, timeoutMs: 2000, priceInPerMTok: 0.4, priceOutPerMTok: 1.6, label: 'hosted:openai', ...o });

  before(async () => {
    fake = await startFakeAi();
  });
  after(() => fake.close());

  test('OpenAI: image, schema and key go in; the reading, tokens and cost come out (FR-AI-01/02/09)', async () => {
    fake.calls.length = 0;
    fake.answer([{ bill: bill([{ n: 1, name: 'PVC pipe 1"', qty: 10, rate: 450, total: 4500 }, { n: 2, name: 'Elbo 1 inch', qty: 20, rate: 60, total: 1200 }], 5700, 'Al-Madina Traders') }]);
    const r = await new OpenAiVision(opts()).extract(await photo(), hints);
    const c = fake.calls[0]!;
    assert.equal(c.path, '/chat/completions');
    assert.equal(c.headers.authorization, 'Bearer sk-test-key-1234567890');
    assert.equal(c.body.model, 'm-1');
    assert.equal(c.body.response_format.json_schema.strict, true);
    assert.match(c.body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
    assert.match(c.body.messages[0].content, /PVC Pipe 1 inch; Elbow 1 inch/, 'shop product names are sent as hints (FR-AI-11)');
    assert.equal(r.partyName, 'Al-Madina Traders');
    assert.equal(r.billTotal, 5700);
    assert.deepEqual(r.lines.map((l) => [l.line_no, l.raw_name, l.qty, l.rate, l.line_total]), [[1, 'PVC pipe 1"', 10, 450, 4500], [2, 'Elbo 1 inch', 20, 60, 1200]]);
    assert.deepEqual(r.usage, { ...r.usage, model: 'gpt-test', tokensIn: 1000, tokensOut: 200, costMicroUsd: 720 });
  });

  test('Gemini: key header, schema, thinking tokens billed as output', async () => {
    fake.calls.length = 0;
    fake.answer([{ bill: bill([{ n: 1, name: 'ٹونٹی', qty: 2, rate: 1350, total: 2700 }]) }]);
    const r = await new GeminiVision(opts({ label: 'gemini', model: 'gemini-x' })).extract(await photo(), hints);
    const c = fake.calls[0]!;
    assert.equal(c.path, '/models/gemini-x:generateContent');
    assert.equal(c.headers['x-goog-api-key'], 'sk-test-key-1234567890');
    assert.equal(c.body.generationConfig.responseMimeType, 'application/json');
    assert.equal(c.body.contents[0].parts[1].inline_data.mime_type, 'image/png');
    assert.equal(r.lines[0]!.raw_name, 'ٹونٹی', 'Urdu stays as written');
    assert.equal(r.usage.tokensOut, 250);
    assert.equal(r.usage.costMicroUsd, Math.round(1000 * 0.4 + 250 * 1.6));
  });

  test('clear errors for a refused key, a busy service, a timeout and a broken answer (FR-AI-07)', async () => {
    const ai = new OpenAiVision(opts({ timeoutMs: 300 }));
    const p = await photo();
    fake.answer([{ status: 401, raw: { error: { message: 'Incorrect API key provided: sk-test-...' } } }]);
    await assert.rejects(ai.extract(p, hints), (e: Error) => /key was refused/.test(e.message) && !e.message.includes('sk-test'));
    fake.answer([{ status: 429, raw: { error: { message: 'Rate limit' } } }]);
    await assert.rejects(ai.extract(p, hints), /busy or the key has no credit/);
    fake.answer([{ delayMs: 800, bill: bill([]) }]);
    await assert.rejects(ai.extract(p, hints), /did not answer within/);
    fake.answer([{ raw: { choices: [{ message: { content: 'sorry, I cannot' } }], usage: {} } }]);
    await assert.rejects(ai.extract(p, hints), /not valid JSON/);
    assert.throws(() => parseAnswer('{"lines":[{"raw_name":5}]}'), /did not match the bill format/);
    const cleaned = parseAnswer('```json\n{"lines":[{"raw_name":" Tee ","confidence":7,"bbox":[0.1,0.2,0.3]},{"raw_name":""}]}\n```');
    assert.deepEqual(cleaned.lines, [{ line_no: null, raw_name: 'Tee', qty: null, unit: null, rate: null, line_total: null, confidence: 1 }], 'fenced JSON, clamped confidence, bad bbox dropped, empty row dropped');
  });
});

describe('long pages are read in overlapping strips (FR-AI-12)', () => {
  /** A fake reader for a 40-row page: rows are 50 px apart on a 2,000 px tall photo. */
  class Rows40 implements AiProvider {
    readonly name = 'fake';
    readonly reads = true;
    readonly seen: { strip?: { index: number; count: number }; height: number }[] = [];
    async extract(page: PageInput, h: ReadHints): Promise<PageExtraction> {
      const height = (await sharp(page.bytes).metadata()).height!;
      this.seen.push({ strip: h.strip, height });
      const usage = { model: 'fake', tokensIn: 10, tokensOut: 5, costMicroUsd: 3, ms: 1 };
      const all = Array.from({ length: 40 }, (_, i) => ({ n: i + 1, y: 25 + i * 50 }));
      if (!h.strip) {
        // whole page: drops rows 31-35, as models do on long lists
        return { partyName: 'Al-Madina', billNo: null, date: null, billTotal: 99, usage, lines: all.filter((r) => r.n <= 30 || r.n > 35).map((r) => ({ line_no: r.n, raw_name: `item ${r.n}`, qty: 1, unit: 'pcs', rate: 1, line_total: 1, confidence: 0.9, bbox: [0, r.y / 2000, 1, 0.01] })) };
      }
      // a strip: rows whose centre is inside it, positioned relative to the strip
      const band = 2000 / h.strip.count;
      const pad = 2000 * 0.08;
      const top = Math.max(0, h.strip.index * band - pad);
      const inside = all.filter((r) => r.y >= top && r.y < top + height);
      return { partyName: null, billNo: null, date: null, billTotal: null, usage, lines: inside.map((r) => ({ line_no: r.n, raw_name: `item ${r.n}`, qty: 1, unit: 'pcs', rate: 1, line_total: 1, confidence: 0.9, bbox: [0, (r.y - top) / height, 1, 10 / height] })) };
    }
  }

  test('rows dropped on the whole page come back, each row counted once, positions mapped to the page', async () => {
    const ai = new Rows40();
    const r = await readPage(ai, await photo(1000, 2000), hints);
    assert.equal(r.strips, 2, '35 rows read at 18 per strip → 2 strips');
    assert.equal(ai.seen.length, 3);
    assert.ok(ai.seen.slice(1).every((s) => s.height < 2000 * 0.6), 'each strip is a part of the page');
    assert.deepEqual(r.lines.map((l) => l.line_no), Array.from({ length: 40 }, (_, i) => i + 1));
    assert.ok(Math.abs(r.lines[39]!.bbox![1]! - 1975 / 2000) < 0.002, 'row 40 is at the bottom of the page');
    assert.equal(r.partyName, 'Al-Madina', 'header and total from the whole page');
    assert.equal(r.billTotal, 99);
    assert.equal(r.usage.costMicroUsd, 9, 'cost of all three calls');
  });

  test(`a page with up to ${STRIP_THRESHOLD} rows is read once; demo mode skips image work`, async () => {
    let calls = 0;
    const short: AiProvider = { name: 'f', reads: true, extract: async () => (calls++, { partyName: null, billNo: null, date: null, billTotal: null, lines: [], usage: { model: 'f', tokensIn: 0, tokensOut: 0, costMicroUsd: 0, ms: 0 } }) };
    assert.equal((await readPage(short, await photo(), hints)).strips, 0);
    assert.equal(calls, 1);
    const demo: AiProvider = { ...short, reads: false };
    const notAnImage = { pageNo: 1, bytes: Buffer.from('not an image'), contentType: 'image/png' };
    assert.equal((await readPage(demo, notAnImage, hints)).strips, 0);
  });
});

test('shop AI keys are encrypted with AES-256-GCM and tampering is detected (NFR-SEC-01)', () => {
  const secret = 'a'.repeat(40);
  const blob = encryptKey('sk-live-abcdef1234567890', secret);
  assert.ok(!blob.toString('latin1').includes('sk-live'));
  assert.equal(decryptKey(blob, secret), 'sk-live-abcdef1234567890');
  assert.throws(() => decryptKey(blob, 'b'.repeat(40)));
  const bad = Buffer.from(blob);
  bad[bad.length - 1]! ^= 1;
  assert.throws(() => decryptKey(bad, secret));
  assert.throws(() => encryptKey('x', ''), /AI_KEY_SECRET/);
});

