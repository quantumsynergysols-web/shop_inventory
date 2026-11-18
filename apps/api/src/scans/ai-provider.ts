import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { AiLine } from '@erp/domain';
import { APP_CONFIG, type AppConfig } from '../config.js';

/**
 * Vision AI behind one interface (C-1, NFR-MNT-01). Adding OpenAI or Gemini means one new class;
 * nothing outside this folder changes. Output follows the extraction contract in SRS §5.4.
 */
export interface PageInput {
  pageNo: number;
  bytes: Buffer;
  contentType: string;
}

export interface PageExtraction {
  partyName: string | null;
  billNo: string | null;
  date: string | null;
  lines: Omit<AiLine, 'page'>[];
  billTotal: number | null;
  usage: { model: string; tokensIn: number; tokensOut: number; costMicroUsd: number; ms: number };
}

export interface ReadHints {
  docType: 'purchase' | 'sale';
  /** FR-AI-11: names the shop often uses */
  knownProducts: string[];
  strip?: { index: number; count: number };
}

export interface AiProvider {
  readonly name: string;
  /** True when it really reads the photo; false for demo/manual mode (FR-AI-08) */
  readonly reads: boolean;
  /** strip: this image is one horizontal strip of a long page (FR-AI-12) */
  extract(page: PageInput, hints: ReadHints): Promise<PageExtraction>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

interface Fixture {
  sha256: string;
  description?: string;
  result: Omit<PageExtraction, 'usage'>;
}

/**
 * Demo mode (FR-AI-08): no AI key is configured.
 * For the bundled sample bills it returns a recorded reading, so a demo shows the full flow;
 * for any other photo it returns no lines and the user types the rows next to the photo.
 * The review screen must say that the reading is simulated.
 */
@Injectable()
export class DemoAiProvider implements AiProvider {
  readonly name = 'demo';
  readonly reads = false;
  private fixtures?: Promise<Map<string, Fixture>>;
  private readonly dir: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.dir = isAbsolute(config.DEMO_FIXTURES_DIR) ? config.DEMO_FIXTURES_DIR : join(process.cwd(), config.DEMO_FIXTURES_DIR);
  }

  /** Tests register fixtures directly. */
  register(f: Fixture): void {
    this.fixtures = this.load().then((m) => m.set(f.sha256, f));
  }

  private load(): Promise<Map<string, Fixture>> {
    this.fixtures ??= (async () => {
      const map = new Map<string, Fixture>();
      let files: string[] = [];
      try {
        files = (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
      } catch {
        return map;
      }
      for (const f of files) {
        const fx = JSON.parse(await readFile(join(this.dir, f), 'utf8')) as Fixture;
        map.set(fx.sha256, fx);
      }
      return map;
    })();
    return this.fixtures;
  }

  async extract(page: PageInput): Promise<PageExtraction> {
    const started = Date.now();
    const sha = createHash('sha256').update(page.bytes).digest('hex');
    const fx = (await this.load()).get(sha);
    const base = fx?.result ?? { partyName: null, billNo: null, date: null, lines: [], billTotal: null };
    return { ...base, usage: { model: fx ? 'demo-recorded' : 'demo-manual', tokensIn: 0, tokensOut: 0, costMicroUsd: 0, ms: Date.now() - started } };
  }
}
