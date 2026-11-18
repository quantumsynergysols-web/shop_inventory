import { createServer, type IncomingMessage, type Server } from 'node:http';

/**
 * A local stand-in for the OpenAI and Gemini HTTP APIs, so the real readers are tested without a key
 * or network. It records every request and answers with whatever the test queues.
 */
export interface FakeCall {
  path: string;
  headers: IncomingMessage['headers'];
  body: any;
}

export interface FakeAnswer {
  status?: number;
  /** The bill JSON the model "read" (wrapped into the provider's response format) */
  bill?: unknown;
  raw?: unknown;
  delayMs?: number;
}

export async function startFakeAi() {
  const calls: FakeCall[] = [];
  let next: ((call: FakeCall) => FakeAnswer) | FakeAnswer[] = [];
  const server: Server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', async () => {
      const call: FakeCall = { path: req.url ?? '', headers: req.headers, body: data ? JSON.parse(data) : null };
      calls.push(call);
      const a: FakeAnswer = typeof next === 'function' ? next(call) : (next.shift() ?? { status: 500, raw: { error: { message: 'no answer queued' } } });
      if (a.delayMs) await new Promise((r) => setTimeout(r, a.delayMs));
      const gemini = call.path.includes(':generateContent');
      const body =
        a.raw ??
        (gemini
          ? { candidates: [{ content: { parts: [{ text: JSON.stringify(a.bill) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 50 }, modelVersion: 'gemini-test' }
          : { model: 'gpt-test', choices: [{ message: { role: 'assistant', content: JSON.stringify(a.bill), refusal: null } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } });
      res.writeHead(a.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    calls,
    base: `http://127.0.0.1:${port}`,
    answer(a: FakeAnswer[] | ((call: FakeCall) => FakeAnswer)) {
      next = a;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** A bill reading in the contract's shape. */
export const bill = (lines: { n?: number | null; name: string; qty?: number | null; rate?: number | null; total?: number | null; conf?: number; bbox?: number[] }[], total: number | null = null, party: string | null = null) => ({
  party_name: party,
  bill_no: null,
  date: null,
  bill_total: total,
  lines: lines.map((l) => ({ line_no: l.n ?? null, raw_name: l.name, qty: l.qty ?? null, unit: 'pcs', rate: l.rate ?? null, line_total: l.total ?? null, confidence: l.conf ?? 0.95, bbox: l.bbox ?? [0.05, 0.1, 0.9, 0.05] })),
});
