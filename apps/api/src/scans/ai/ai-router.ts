import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DemoAiProvider, type AiProvider } from '../ai-provider.js';
import { decryptKey } from './key-crypto.js';
import { GeminiVision, OpenAiVision, type VisionOptions } from './vision-providers.js';

export type AiMode = 'hosted' | 'openai' | 'gemini' | 'off';
/** Why a scan opened in manual mode instead of being read (shown on the review screen) */
export type AiNotice = 'AI_NOT_CONFIGURED' | 'AI_NO_CONSENT' | 'AI_QUOTA_REACHED' | 'AI_KEY_UNREADABLE';

export interface AiChoice {
  provider: AiProvider;
  notice: AiNotice | null;
}

export interface AiUsage {
  mode: AiMode;
  /** Scans read by the hosted key this month, and the limit (FR-AI-10) */
  usedThisMonth: number;
  quota: number | null;
  costThisMonthMicroUsd: number;
}

/** First day of this month in Pakistan time, as a UTC instant. */
export function monthStart(now = new Date()): Date {
  const pk = new Date(now.getTime() + 5 * 3600_000);
  return new Date(Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), 1) - 5 * 3600_000);
}

/**
 * FR-AI-15/16, FR-SET-02: chooses the reader for one shop's scan.
 * - Default "hosted": QSSols key from the server's env, limited to a monthly number of scans.
 * - "openai" / "gemini": the shop's own key (stored encrypted), no QSSols limit.
 * - "off", no key configured, no owner consent, or the limit reached: demo/manual mode (FR-AI-08),
 *   so the flow always continues with the photo beside empty rows.
 */
@Injectable()
export class AiRouter {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: PrismaService,
    private readonly demo: DemoAiProvider,
  ) {}

  private options(kind: 'openai' | 'gemini', apiKey: string, model: string | null, label: string): VisionOptions {
    const c = this.config;
    return kind === 'openai'
      ? { apiKey, model: model || c.OPENAI_MODEL, baseUrl: c.OPENAI_BASE_URL, timeoutMs: c.AI_TIMEOUT_MS, priceInPerMTok: c.OPENAI_PRICE_IN_PER_MTOK, priceOutPerMTok: c.OPENAI_PRICE_OUT_PER_MTOK, label }
      : { apiKey, model: model || c.GEMINI_MODEL, baseUrl: c.GEMINI_BASE_URL, timeoutMs: c.AI_TIMEOUT_MS, priceInPerMTok: c.GEMINI_PRICE_IN_PER_MTOK, priceOutPerMTok: c.GEMINI_PRICE_OUT_PER_MTOK, label };
  }

  /** A reader for a provider and key, e.g. for the settings screen's "test connection". */
  build(kind: 'openai' | 'gemini', apiKey: string, model: string | null, label: string = kind): AiProvider {
    const o = this.options(kind, apiKey, model, label);
    return kind === 'openai' ? new OpenAiVision(o) : new GeminiVision(o);
  }

  hostedAvailable(): boolean {
    const c = this.config;
    return (c.HOSTED_AI_PROVIDER === 'openai' && !!c.OPENAI_API_KEY) || (c.HOSTED_AI_PROVIDER === 'gemini' && !!c.GEMINI_API_KEY);
  }

  async usage(shopId: string): Promise<AiUsage> {
    const s = await this.db.aiSetting.findUnique({ where: { shopId } });
    const mode = (s?.provider ?? 'hosted') as AiMode;
    const since = monthStart();
    const [hosted, cost] = await Promise.all([
      this.db.aiCallLog.findMany({ where: { shopId, ok: true, provider: { startsWith: 'hosted:' }, createdAt: { gte: since } }, distinct: ['scanId'], select: { scanId: true } }),
      this.db.aiCallLog.aggregate({ where: { shopId, createdAt: { gte: since } }, _sum: { costMicroUsd: true } }),
    ]);
    return { mode, usedThisMonth: hosted.length, quota: mode === 'hosted' ? (s?.monthlyScanQuota ?? this.config.HOSTED_MONTHLY_SCANS) : null, costThisMonthMicroUsd: Number(cost._sum.costMicroUsd ?? 0n) };
  }

  /** Called once per scan; a re-read (retry) of the same scan does not count twice against the limit. */
  async forShop(shopId: string, scanId: string): Promise<AiChoice> {
    const [shop, s] = await Promise.all([this.db.shop.findUniqueOrThrow({ where: { id: shopId } }), this.db.aiSetting.findUnique({ where: { shopId } })]);
    const mode = (s?.provider ?? 'hosted') as AiMode;
    const manual = (notice: AiNotice | null): AiChoice => ({ provider: this.demo, notice });
    if (mode === 'off') return manual(null);

    let reader: AiProvider;
    if (mode === 'hosted') {
      if (!this.hostedAvailable()) return manual('AI_NOT_CONFIGURED');
      const kind = this.config.HOSTED_AI_PROVIDER as 'openai' | 'gemini';
      reader = this.build(kind, kind === 'openai' ? this.config.OPENAI_API_KEY : this.config.GEMINI_API_KEY, null, `hosted:${kind}`);
    } else {
      if (!s?.apiKeyEnc || !this.config.AI_KEY_SECRET) return manual('AI_NOT_CONFIGURED');
      let key: string;
      try {
        key = decryptKey(s.apiKeyEnc, this.config.AI_KEY_SECRET);
      } catch {
        return manual('AI_KEY_UNREADABLE');
      }
      reader = this.build(mode, key, s.model, mode);
    }
    // FR-AI-16: photos go to a foreign provider only after the owner agreed once
    if (!shop.aiConsentAt) return manual('AI_NO_CONSENT');
    if (mode === 'hosted') {
      const u = await this.usage(shopId);
      const already = await this.db.aiCallLog.count({ where: { scanId, ok: true, provider: { startsWith: 'hosted:' } } });
      if (u.quota != null && u.usedThisMonth >= u.quota && !already) return manual('AI_QUOTA_REACHED');
    }
    return { provider: reader, notice: null };
  }
}
