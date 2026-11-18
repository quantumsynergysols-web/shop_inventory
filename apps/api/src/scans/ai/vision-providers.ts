import type { AiProvider, PageExtraction, PageInput, ReadHints } from '../ai-provider.js';
import { AiAnswerError, costMicroUsd, GEMINI_SCHEMA, OPENAI_SCHEMA, parseAnswer, prompt } from './contract.js';

export interface VisionOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  priceInPerMTok: number;
  priceOutPerMTok: number;
  /** Logged as the provider, e.g. "hosted:openai" (FR-AI-09) */
  label: string;
}

export type Hints = ReadHints;

/** Errors that say what went wrong without the key or the request body. */
export class AiCallError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timeout = (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError';
    throw new AiCallError(timeout ? `The AI did not answer within ${Math.round(timeoutMs / 1000)} s` : 'Could not reach the AI service');
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep null */
  }
  if (!res.ok) {
    const msg = json?.error?.message ?? text.slice(0, 200);
    if (res.status === 401 || res.status === 403) throw new AiCallError('The AI key was refused (check the key in AI settings)', res.status);
    if (res.status === 429) throw new AiCallError('The AI service is busy or the key has no credit left (rate limit)', res.status);
    throw new AiCallError(`AI service error ${res.status}: ${String(msg).slice(0, 200)}`, res.status);
  }
  return json;
}

const dataUrl = (p: PageInput) => `data:${p.contentType};base64,${p.bytes.toString('base64')}`;

/** OpenAI Chat Completions with an image and strict structured output (FR-AI-01). */
export class OpenAiVision implements AiProvider {
  readonly reads = true;
  constructor(private readonly o: VisionOptions) {}
  get name() {
    return this.o.label;
  }

  async extract(page: PageInput, hints: Hints): Promise<PageExtraction> {
    const started = Date.now();
    const json = await postJson(
      `${this.o.baseUrl.replace(/\/$/, '')}/chat/completions`,
      { authorization: `Bearer ${this.o.apiKey}` },
      {
        model: this.o.model,
        temperature: 0,
        messages: [
          { role: 'system', content: prompt(hints, hints.strip) },
          { role: 'user', content: [{ type: 'text', text: 'Read this bill image and return the JSON.' }, { type: 'image_url', image_url: { url: dataUrl(page), detail: 'high' } }] },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'bill_page', strict: true, schema: OPENAI_SCHEMA } },
      },
      this.o.timeoutMs,
    );
    const msg = json?.choices?.[0]?.message;
    if (msg?.refusal) throw new AiAnswerError(`The AI refused to read this photo: ${String(msg.refusal).slice(0, 150)}`);
    if (typeof msg?.content !== 'string') throw new AiAnswerError('The AI returned no answer');
    const tokensIn = Number(json.usage?.prompt_tokens ?? 0);
    const tokensOut = Number(json.usage?.completion_tokens ?? 0);
    return {
      ...parseAnswer(msg.content),
      usage: { model: String(json.model ?? this.o.model), tokensIn, tokensOut, costMicroUsd: costMicroUsd(tokensIn, tokensOut, this.o.priceInPerMTok, this.o.priceOutPerMTok), ms: Date.now() - started },
    };
  }
}

/** Google Gemini generateContent with inline image and a response schema (FR-AI-01). */
export class GeminiVision implements AiProvider {
  readonly reads = true;
  constructor(private readonly o: VisionOptions) {}
  get name() {
    return this.o.label;
  }

  async extract(page: PageInput, hints: Hints): Promise<PageExtraction> {
    const started = Date.now();
    const json = await postJson(
      `${this.o.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(this.o.model)}:generateContent`,
      { 'x-goog-api-key': this.o.apiKey },
      {
        systemInstruction: { parts: [{ text: prompt(hints, hints.strip) }] },
        contents: [{ role: 'user', parts: [{ text: 'Read this bill image and return the JSON.' }, { inline_data: { mime_type: page.contentType, data: page.bytes.toString('base64') } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA },
      },
      this.o.timeoutMs,
    );
    const cand = json?.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
    if (!text) throw new AiAnswerError(`The AI returned no answer${cand?.finishReason ? ` (${cand.finishReason})` : json?.promptFeedback?.blockReason ? ` (${json.promptFeedback.blockReason})` : ''}`);
    const u = json.usageMetadata ?? {};
    const tokensIn = Number(u.promptTokenCount ?? 0);
    // Thinking tokens are billed as output
    const tokensOut = Number(u.candidatesTokenCount ?? 0) + Number(u.thoughtsTokenCount ?? 0);
    return {
      ...parseAnswer(text),
      usage: { model: String(json.modelVersion ?? this.o.model), tokensIn, tokensOut, costMicroUsd: costMicroUsd(tokensIn, tokensOut, this.o.priceInPerMTok, this.o.priceOutPerMTok), ms: Date.now() - started },
    };
  }
}
