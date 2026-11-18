import { BadRequestException, Body, Controller, Get, Inject, Post, Put } from '@nestjs/common';
import sharp from 'sharp';
import { z } from 'zod';
import { CurrentUser, Requires, type AuthUser } from '../../auth/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AiRouter, type AiMode } from './ai-router.js';
import { decryptKey, encryptKey } from './key-crypto.js';

const mode = z.enum(['hosted', 'openai', 'gemini', 'off']);
const saveBody = z.object({
  mode,
  model: z.string().trim().max(80).nullable().optional(),
  /** A new key for the shop's own provider; omitted = keep the stored one; "" = remove it */
  apiKey: z.string().trim().max(400).optional(),
  confidenceThreshold: z.number().min(0.5).max(0.99).optional(),
  photoRetentionDays: z.number().int().min(30).max(3650).optional(),
});
const testBody = z.object({ mode: mode.optional(), model: z.string().trim().max(80).nullable().optional(), apiKey: z.string().trim().max(400).optional() });

/** FR-SET-02 (AI settings), FR-AI-10/15 (usage and limit), FR-AI-16 (consent, photo retention). Owner only. */
@Controller('settings/ai')
export class AiSettingsController {
  constructor(
    private readonly db: PrismaService,
    private readonly router: AiRouter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Requires('settings.manage')
  @Get()
  async get(@CurrentUser() u: AuthUser) {
    const [shop, s, usage] = await Promise.all([this.db.shop.findUniqueOrThrow({ where: { id: u.shopId } }), this.db.aiSetting.findUnique({ where: { shopId: u.shopId } }), this.router.usage(u.shopId)]);
    return {
      mode: (s?.provider ?? 'hosted') as AiMode,
      model: s?.model ?? null,
      // NFR-SEC-01: only the last 4 characters ever leave the server
      keyLast4: s?.apiKeyLast4 ?? null,
      hostedAvailable: this.router.hostedAvailable(),
      hostedProvider: this.config.HOSTED_AI_PROVIDER,
      canStoreKeys: !!this.config.AI_KEY_SECRET,
      defaultModels: { openai: this.config.OPENAI_MODEL, gemini: this.config.GEMINI_MODEL },
      consentAt: shop.aiConsentAt,
      photoRetentionDays: shop.photoRetentionDays,
      confidenceThreshold: s?.confidenceThreshold ?? 0.85,
      usage,
    };
  }

  @Requires('settings.manage')
  @Put()
  async save(@CurrentUser() u: AuthUser, @Body(new ZodPipe(saveBody)) b: z.infer<typeof saveBody>) {
    const own = b.mode === 'openai' || b.mode === 'gemini';
    const prev = await this.db.aiSetting.findUnique({ where: { shopId: u.shopId } });
    let key: { apiKeyEnc: Uint8Array<ArrayBuffer> | null; apiKeyLast4: string | null } | null = null;
    if (b.apiKey !== undefined) {
      if (b.apiKey === '') key = { apiKeyEnc: null, apiKeyLast4: null };
      else {
        if (!this.config.AI_KEY_SECRET) throw new BadRequestException('The server cannot store keys yet (AI_KEY_SECRET is not set)');
        if (b.apiKey.length < 20) throw new BadRequestException('This does not look like an API key');
        key = { apiKeyEnc: new Uint8Array(encryptKey(b.apiKey, this.config.AI_KEY_SECRET)), apiKeyLast4: b.apiKey.slice(-4) };
      }
    }
    if (own && !(key?.apiKeyEnc ?? prev?.apiKeyEnc)) throw new BadRequestException('Enter the API key of your own OpenAI or Gemini account');
    const data = {
      provider: b.mode,
      model: b.model === undefined ? (prev?.model ?? null) : b.model || null,
      ...(key ?? {}),
      ...(b.confidenceThreshold !== undefined ? { confidenceThreshold: b.confidenceThreshold } : {}),
    };
    await this.db.aiSetting.upsert({ where: { shopId: u.shopId }, create: { shopId: u.shopId, ...data }, update: data });
    if (b.photoRetentionDays !== undefined) await this.db.shop.update({ where: { id: u.shopId }, data: { photoRetentionDays: b.photoRetentionDays } });
    // FR-SET-04: the audit log never holds the key itself
    await this.db.auditLog.create({
      data: { shopId: u.shopId, userId: u.userId, action: 'settings.ai', entity: 'ai_setting', entityId: u.shopId, before: { mode: prev?.provider ?? 'hosted', model: prev?.model ?? null, keyLast4: prev?.apiKeyLast4 ?? null }, after: { mode: b.mode, model: data.model, keyLast4: key ? key.apiKeyLast4 : (prev?.apiKeyLast4 ?? null), confidenceThreshold: b.confidenceThreshold, photoRetentionDays: b.photoRetentionDays } },
    });
    return this.get(u);
  }

  /** FR-AI-16: the owner agrees once that bill photos are read by a foreign AI provider. */
  @Requires('settings.manage')
  @Post('consent')
  async consent(@CurrentUser() u: AuthUser, @Body(new ZodPipe(z.object({ agree: z.literal(true) }))) _b: { agree: true }) {
    const shop = await this.db.shop.update({ where: { id: u.shopId }, data: { aiConsentAt: new Date() } });
    await this.db.auditLog.create({ data: { shopId: u.shopId, userId: u.userId, action: 'settings.ai_consent', entity: 'shop', entityId: u.shopId, after: { consentAt: shop.aiConsentAt } } });
    return { consentAt: shop.aiConsentAt };
  }

  @Requires('settings.manage')
  @Post('consent/withdraw')
  async withdraw(@CurrentUser() u: AuthUser) {
    await this.db.shop.update({ where: { id: u.shopId }, data: { aiConsentAt: null } });
    await this.db.auditLog.create({ data: { shopId: u.shopId, userId: u.userId, action: 'settings.ai_consent_withdrawn', entity: 'shop', entityId: u.shopId } });
    return { consentAt: null };
  }

  /** FR-SET-02 "test connection": reads a small generated image with the chosen provider and key. */
  @Requires('settings.manage')
  @Post('test')
  async test(@CurrentUser() u: AuthUser, @Body(new ZodPipe(testBody)) b: z.infer<typeof testBody>) {
    const s = await this.db.aiSetting.findUnique({ where: { shopId: u.shopId } });
    const m = b.mode ?? ((s?.provider ?? 'hosted') as AiMode);
    if (m === 'off') return { ok: false, error: 'AI reading is switched off' };
    let reader;
    if (m === 'hosted') {
      if (!this.router.hostedAvailable()) return { ok: false, error: 'No hosted AI key is set on the server yet' };
      const kind = this.config.HOSTED_AI_PROVIDER as 'openai' | 'gemini';
      reader = this.router.build(kind, kind === 'openai' ? this.config.OPENAI_API_KEY : this.config.GEMINI_API_KEY, null, `hosted:${kind}`);
    } else {
      let key = b.apiKey;
      if (!key && s?.apiKeyEnc && this.config.AI_KEY_SECRET && s.provider === m) key = decryptKey(s.apiKeyEnc, this.config.AI_KEY_SECRET);
      if (!key) return { ok: false, error: 'Enter the API key first' };
      reader = this.router.build(m, key, b.model ?? s?.model ?? null);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140"><rect width="100%" height="100%" fill="white"/><text x="20" y="50" font-size="28" font-family="Arial">1  PVC Pipe 1 inch   10   450   4500</text><text x="20" y="110" font-size="28" font-family="Arial">Total 4500</text></svg>`;
    const bytes = await sharp(Buffer.from(svg)).jpeg().toBuffer();
    const started = Date.now();
    try {
      const r = await reader.extract({ pageNo: 1, bytes, contentType: 'image/jpeg' }, { docType: 'purchase', knownProducts: [] });
      return { ok: true, ms: Date.now() - started, model: r.usage.model, linesRead: r.lines.length };
    } catch (e) {
      return { ok: false, ms: Date.now() - started, error: (e as Error).message };
    }
  }
}
