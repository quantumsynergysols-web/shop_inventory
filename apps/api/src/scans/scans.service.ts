import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { Prisma, type PayMode, type ScanStatus, type ScanType } from '@prisma/client';
import {
  can,
  checkExtraction,
  lineAmount,
  matchProduct,
  mulDiv,
  normalizeName,
  normalizeUnit,
  toBaseQty,
  type AiLine,
  type CatalogAlias,
  type CatalogProduct,
  type MatchStatus,
  type Paisa,
  type QtyMilli,
  type UnitCode,
} from '@erp/domain';
import type { AuthUser } from '../auth/decorators.js';
import { big, dec, milli, paisa } from '../common/convert.js';
import { DocumentsService, type DocumentView } from '../documents/documents.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FILE_STORAGE, type FileStorage } from '../storage/storage.js';
import { AI_PROVIDER, type AiProvider } from './ai-provider.js';

export const ALLOWED_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic' };
export const MAX_PAGES = 10; // FR-SCAN-03
export const MAX_BYTES = 15 * 1024 * 1024; // FR-SCAN-02

export interface UploadedPage {
  bytes: Buffer;
  contentType: string;
}

export interface ScanLineView {
  id: string;
  lineNo: number;
  serialNo: number | null;
  page: number;
  rawName: string;
  qtyMilli: QtyMilli | null;
  unit: string | null;
  ratePaisa: Paisa | null;
  lineTotalPaisa: Paisa | null;
  amountPaisa: Paisa | null;
  confidence: number;
  bbox: unknown;
  flags: string[];
  matchStatus: string | null;
  matchScore: number | null;
  product: { id: string; name: string; sku: string; baseUnit: string; onHandMilli: QtyMilli; salePricePaisa: Paisa; purchasePricePaisa: Paisa } | null;
  suggestions: { productId: string; name: string; score: number }[];
  /** Sale: true when the bill asks for more than stock on hand (FR-REV-07) */
  shortStock: boolean;
  /** Purchase: stored vs written price per base unit (FR-REV-09). Sale: list price vs written (FR-REV-08). */
  priceDiff: { listPaisa: Paisa; writtenPaisa: Paisa } | null;
}

export interface ScanView {
  id: string;
  type: ScanType;
  status: ScanStatus;
  provider: string;
  /** False in demo/manual mode: the UI must say the reading is simulated or manual */
  aiReads: boolean;
  pageCount: number;
  partyNameRead: string | null;
  billNoRead: string | null;
  suggestedParty: { id: string; name: string } | null;
  readTotalPaisa: Paisa | null;
  linesTotalPaisa: Paisa;
  flags: string[];
  missingSerials: number[];
  failureReason: string | null;
  documentId: string | null;
  createdAt: Date;
  createdBy: string;
  lines: ScanLineView[];
  /** Lines that still block Confirm */
  blockingCount: number;
}

export interface LineEdit {
  id?: string;
  serialNo?: number | null;
  page?: number;
  rawName: string;
  qtyMilli: QtyMilli | null;
  unit?: string | null;
  ratePaisa: Paisa | null;
  productId: string | null;
}

const BLOCKING = new Set(['MISSING_QTY', 'MISSING_RATE', 'UNKNOWN_UNIT', 'BAD_NUMBER']);

@Injectable()
export class ScansService implements OnApplicationBootstrap {
  private readonly log = new Logger('Scans');
  /** Running extractions, so tests and shutdown can wait for them */
  readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly db: PrismaService,
    private readonly documents: DocumentsService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  /**
   * Extraction runs in-process, so a restart drops work in flight. Scans left PROCESSING for more
   * than 5 minutes are marked FAILED; the user retries or continues manually (FR-AI-07).
   */
  async onApplicationBootstrap(): Promise<void> {
    const r = await this.db.scan
      .updateMany({ where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } }, data: { status: 'FAILED', failureReason: 'Reading was interrupted (server restarted). Retry or continue manually.' } })
      .catch(() => ({ count: 0 }));
    if (r.count) this.log.warn(`marked ${r.count} interrupted scan(s) as failed`);
  }

  private assertCanScan(user: AuthUser, type: ScanType): void {
    const action = type === 'SALE' ? 'sale.create' : 'purchase.create';
    if (!can(user.role, action)) throw new ForbiddenException(`Your role (${user.role}) cannot do ${action}`);
  }

  /** FR-SCAN-01..03, FR-SCAN-08, FR-SCAN-09 (exact-duplicate photos are flagged; perceptual hash later). */
  async create(user: AuthUser, type: ScanType, pages: UploadedPage[], clientId: string | null): Promise<ScanView> {
    this.assertCanScan(user, type);
    if (pages.length === 0) throw new BadRequestException('Add at least one photo');
    if (pages.length > MAX_PAGES) throw new BadRequestException(`At most ${MAX_PAGES} pages per bill`);
    for (const p of pages) {
      if (!ALLOWED_TYPES[p.contentType]) throw new BadRequestException(`Photo type ${p.contentType} is not supported (JPEG, PNG, WebP, HEIC)`);
      if (p.bytes.length > MAX_BYTES) throw new BadRequestException('A photo is larger than 15 MB');
    }
    if (clientId) {
      const again = await this.db.scan.findFirst({ where: { shopId: user.shopId, clientId } });
      if (again) return this.get(user, again.id); // offline queue re-sent the same scan (FR-SCAN-07)
    }
    const id = randomUUID();
    const hashes = pages.map((p) => createHash('sha256').update(p.bytes).digest('hex'));
    for (const [i, p] of pages.entries()) await this.storage.put(`scans/${user.shopId}/${id}/page-${i + 1}.${ALLOWED_TYPES[p.contentType]}`, p.bytes);
    const dupes = await this.db.scanPage.count({ where: { phash: { in: hashes }, scan: { shopId: user.shopId, status: 'CONFIRMED' } } });
    await this.db.scan.create({
      data: {
        id,
        shopId: user.shopId,
        userId: user.userId,
        type,
        status: 'PROCESSING',
        clientId,
        pageCount: pages.length,
        checkFlags: dupes ? ['DUPLICATE_PHOTO'] : [],
        pages: { create: pages.map((p, i) => ({ pageNo: i + 1, imageKey: `scans/${user.shopId}/${id}/page-${i + 1}.${ALLOWED_TYPES[p.contentType]}`, phash: hashes[i] })) },
      },
    });
    await this.db.auditLog.create({ data: { shopId: user.shopId, userId: user.userId, action: 'scan.create', entity: 'scan', entityId: id, after: { type, pages: pages.length } } });
    this.start(id);
    return this.get(user, id);
  }

  private start(id: string): void {
    // In-process for now; a pg-boss queue replaces this so work survives restarts (FR-AI-06).
    const p = this.process(id).finally(() => this.running.delete(id));
    this.running.set(id, p);
  }

  /** FR-AI-01..09, FR-AI-12/13: read every page in parallel, merge, check, match. */
  async process(id: string): Promise<void> {
    const scan = await this.db.scan.findUniqueOrThrow({ where: { id }, include: { pages: { orderBy: { pageNo: 'asc' } } } });
    try {
      const known = await this.db.product.findMany({ where: { shopId: scan.shopId, active: true }, select: { name: true }, orderBy: { updatedAt: 'desc' }, take: 200 });
      const docType = scan.type === 'SALE' ? 'sale' : 'purchase';
      const results = await Promise.all(
        scan.pages.map(async (pg) => {
          const bytes = await this.storage.get(pg.imageKey);
          const ext = pg.imageKey.split('.').pop()!;
          const contentType = Object.entries(ALLOWED_TYPES).find(([, e]) => e === ext)?.[0] ?? 'image/jpeg';
          const r = await this.ai.extract({ pageNo: pg.pageNo, bytes, contentType }, { docType, knownProducts: known.map((k) => k.name) });
          await this.db.aiCallLog.create({
            data: { shopId: scan.shopId, scanId: id, provider: this.ai.name, model: r.usage.model, pageNo: pg.pageNo, tokensIn: r.usage.tokensIn, tokensOut: r.usage.tokensOut, costMicroUsd: BigInt(r.usage.costMicroUsd), ms: r.usage.ms, ok: true },
          });
          return { pageNo: pg.pageNo, r };
        }),
      );
      const all: AiLine[] = results.flatMap(({ pageNo, r }) => r.lines.map((l) => ({ ...l, page: pageNo })));
      const billTotal = [...results].reverse().find(({ r }) => r.billTotal != null)?.r.billTotal ?? null;
      const head = results.find(({ r }) => r.partyName)?.r;
      const shop = await this.db.aiSetting.findUnique({ where: { shopId: scan.shopId } });
      const check = checkExtraction(all, billTotal, { confidenceThreshold: shop?.confidenceThreshold ?? 0.85 });

      const lines: Prisma.ScanLineCreateManyInput[] = [];
      for (const [i, l] of check.lines.entries()) {
        const m = await this.match(scan.shopId, l.rawName, null);
        const flags: string[] = [...l.flags];
        let rate = l.ratePaisa;
        if (m.productId && rate == null && l.qtyMilli && scan.type === 'SALE') {
          // FR-REV-08: no rate written → product's sale price
          const p = await this.db.product.findUnique({ where: { id: m.productId } });
          if (p) {
            rate = paisa(p.salePricePaisa);
            const i = flags.indexOf('MISSING_RATE');
            if (i >= 0) flags.splice(i, 1);
            flags.push('RATE_FROM_LIST');
          }
        }
        if (!m.productId) flags.push(m.status === 'suggest' ? 'PICK_PRODUCT' : 'NEW_PRODUCT');
        lines.push({
          scanId: id,
          lineNo: i + 1,
          serialNo: l.serialNo,
          page: l.page,
          rawName: l.rawName,
          qty: l.qtyMilli == null ? null : dec(l.qtyMilli),
          unit: l.unit,
          ratePaisa: rate == null ? null : big(rate),
          lineTotalPaisa: l.lineTotalPaisa == null ? null : big(l.lineTotalPaisa),
          confidence: l.confidence,
          bbox: l.bbox ? (l.bbox as Prisma.InputJsonValue) : Prisma.JsonNull,
          productId: m.productId,
          matchScore: m.score,
          matchStatus: m.status,
          flags,
        });
      }
      await this.db.$transaction([
        this.db.scanLine.deleteMany({ where: { scanId: id } }),
        this.db.scanLine.createMany({ data: lines }),
        this.db.scan.update({
          where: { id },
          data: {
            status: 'NEEDS_REVIEW',
            readTotalPaisa: check.billTotalPaisa == null ? null : big(check.billTotalPaisa),
            partyNameRead: head?.partyName ?? null,
            billNoRead: head?.billNo ?? null,
            checkFlags: [...new Set([...scan.checkFlags.filter((f) => f === 'DUPLICATE_PHOTO'), ...check.flags, ...(this.ai.reads ? [] : ['DEMO_MODE'])])],
            missingSerials: check.missingSerials,
            failureReason: null,
          },
        }),
      ]);
    } catch (e) {
      this.log.error(`scan ${id} failed: ${(e as Error).message}`);
      await this.db.aiCallLog.create({ data: { shopId: scan.shopId, scanId: id, provider: this.ai.name, model: '-', tokensIn: 0, tokensOut: 0, costMicroUsd: 0n, ms: 0, ok: false, error: String((e as Error).message).slice(0, 500) } }).catch(() => {});
      await this.db.scan.update({ where: { id }, data: { status: 'FAILED', failureReason: String((e as Error).message).slice(0, 300) } });
    }
  }

  /**
   * Candidates from PostgreSQL by trigram similarity, then the domain matcher decides
   * (alias → exact → fuzzy with size rules; UML diagram 08). Scales to 20,000 products (NFR-SCL-01).
   */
  async match(shopId: string, rawName: string, partyId: string | null): Promise<{ status: MatchStatus; productId: string | null; score: number; suggestions: { productId: string; score: number }[] }> {
    const n = normalizeName(rawName);
    if (!n) return { status: 'new', productId: null, score: 0, suggestions: [] };
    const ids = await this.db.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM "product" p
      WHERE p."shopId" = ${shopId}::uuid AND p.active
      ORDER BY greatest(similarity(p."normalizedName", ${n}),
                        coalesce((SELECT max(similarity(a.normalized, ${n})) FROM "product_alias" a WHERE a."productId" = p.id), 0)) DESC
      LIMIT 25`;
    if (ids.length === 0) return { status: 'new', productId: null, score: 0, suggestions: [] };
    const rows = await this.db.product.findMany({ where: { id: { in: ids.map((i) => i.id) } }, include: { aliases: true } });
    const products: CatalogProduct[] = rows.map((p) => ({ id: p.id, name: p.name, normalized: p.normalizedName }));
    const aliases: CatalogAlias[] = rows.flatMap((p) => p.aliases.map((a) => ({ productId: p.id, text: a.text, normalized: a.normalized, partyId: a.partyId })));
    return matchProduct(rawName, products, aliases, { partyId });
  }

  async list(user: AuthUser, f: { status?: ScanStatus; limit?: number }) {
    const rows = await this.db.scan.findMany({
      where: { shopId: user.shopId, ...(f.status ? { status: f.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(f.limit ?? 30, 100),
      include: { user: { select: { name: true } }, _count: { select: { lines: { where: { deleted: false } } } } },
    });
    return rows.map((s) => ({ id: s.id, type: s.type, status: s.status, pageCount: s.pageCount, lineCount: s._count.lines, createdAt: s.createdAt, createdBy: s.user.name, documentId: s.documentId, flags: s.checkFlags }));
  }

  async get(user: AuthUser, id: string): Promise<ScanView> {
    const s = await this.db.scan.findFirst({
      where: { id, shopId: user.shopId },
      include: { user: { select: { name: true } }, lines: { where: { deleted: false }, orderBy: { lineNo: 'asc' }, include: { product: { include: { units: true } } } } },
    });
    if (!s) throw new NotFoundException('Scan not found');
    const lines: ScanLineView[] = [];
    for (const l of s.lines) {
      const qty = l.qty == null ? null : milli(l.qty);
      const rate = l.ratePaisa == null ? null : paisa(l.ratePaisa);
      let suggestions: ScanLineView['suggestions'] = [];
      if (!l.productId && s.status === 'NEEDS_REVIEW') {
        const m = await this.match(s.shopId, l.rawName, null);
        const names = await this.db.product.findMany({ where: { id: { in: m.suggestions.map((x) => x.productId) } }, select: { id: true, name: true } });
        suggestions = m.suggestions.map((x) => ({ productId: x.productId, score: x.score, name: names.find((n) => n.id === x.productId)?.name ?? '' }));
      }
      let shortStock = false;
      let priceDiff: ScanLineView['priceDiff'] = null;
      const p = l.product;
      if (p && qty != null && qty > 0) {
        const base = normalizeUnit(p.baseUnit) as UnitCode;
        const unit = (l.unit ? normalizeUnit(l.unit) : base) ?? base;
        let qtyBase: number | null = null;
        try {
          qtyBase = toBaseQty(qty, unit, { baseUnit: base, conversions: p.units.map((u) => ({ unit: normalizeUnit(u.unit) as UnitCode, factorToBase: Number(u.factorToBase) })) });
        } catch {
          qtyBase = null;
        }
        if (s.type === 'SALE' && qtyBase != null) shortStock = qtyBase > milli(p.onHand);
        if (rate != null && qtyBase) {
          const perBase = mulDiv(lineAmount(qty, rate), 1000, qtyBase);
          const list = s.type === 'SALE' ? paisa(p.salePricePaisa) : paisa(p.purchasePricePaisa);
          if (list && perBase !== list) priceDiff = { listPaisa: list, writtenPaisa: perBase };
        }
      }
      lines.push({
        id: l.id,
        lineNo: l.lineNo,
        serialNo: l.serialNo,
        page: l.page,
        rawName: l.rawName,
        qtyMilli: qty,
        unit: l.unit,
        ratePaisa: rate,
        lineTotalPaisa: l.lineTotalPaisa == null ? null : paisa(l.lineTotalPaisa),
        amountPaisa: qty != null && rate != null ? lineAmount(qty, rate) : l.lineTotalPaisa == null ? null : paisa(l.lineTotalPaisa),
        confidence: l.confidence,
        bbox: l.bbox,
        flags: l.flags,
        matchStatus: l.matchStatus,
        matchScore: l.matchScore,
        product: p ? { id: p.id, name: p.name, sku: p.sku, baseUnit: p.baseUnit, onHandMilli: milli(p.onHand), salePricePaisa: paisa(p.salePricePaisa), purchasePricePaisa: paisa(p.purchasePricePaisa) } : null,
        suggestions,
        shortStock,
        priceDiff,
      });
    }
    let suggestedParty: ScanView['suggestedParty'] = null;
    if (s.partyNameRead) {
      // FR-PTY-04: match the party name read from the photo
      const n = normalizeName(s.partyNameRead);
      const hit = await this.db.$queryRaw<{ id: string; name: string }[]>`
        SELECT id, name FROM "party" WHERE "shopId" = ${s.shopId}::uuid AND type IN (${s.type === 'SALE' ? 'CUSTOMER' : 'SUPPLIER'}::"PartyType", 'BOTH'::"PartyType")
          AND similarity("normalizedName", ${n}) > 0.4 ORDER BY similarity("normalizedName", ${n}) DESC LIMIT 1`;
      suggestedParty = hit[0] ?? null;
    }
    const blocking = lines.filter((l) => !l.product || l.qtyMilli == null || l.qtyMilli <= 0 || l.ratePaisa == null || l.flags.some((f) => BLOCKING.has(f)) || (s.type === 'SALE' && l.shortStock)).length;
    return {
      id: s.id,
      type: s.type,
      status: s.status,
      provider: this.ai.name,
      aiReads: this.ai.reads,
      pageCount: s.pageCount,
      partyNameRead: s.partyNameRead,
      billNoRead: s.billNoRead,
      suggestedParty,
      readTotalPaisa: s.readTotalPaisa == null ? null : paisa(s.readTotalPaisa),
      linesTotalPaisa: lines.reduce((a, l) => a + (l.amountPaisa ?? 0), 0),
      flags: s.checkFlags,
      missingSerials: s.missingSerials,
      failureReason: s.failureReason,
      documentId: s.documentId,
      createdAt: s.createdAt,
      createdBy: s.user.name,
      lines: orderForReview(lines),
      blockingCount: blocking,
    };
  }

  async page(user: AuthUser, id: string, pageNo: number): Promise<{ bytes: Buffer; contentType: string }> {
    const pg = await this.db.scanPage.findFirst({ where: { scanId: id, pageNo, scan: { shopId: user.shopId } } });
    if (!pg) throw new NotFoundException('Page not found');
    const ext = pg.imageKey.split('.').pop()!;
    return { bytes: await this.storage.get(pg.imageKey), contentType: Object.entries(ALLOWED_TYPES).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream' };
  }

  /** FR-REV-02, FR-REV-11: every field is editable; rows can be added and deleted; the draft is saved on every change. */
  async saveLines(user: AuthUser, id: string, edits: LineEdit[]): Promise<ScanView> {
    const s = await this.db.scan.findFirst({ where: { id, shopId: user.shopId }, include: { lines: true } });
    if (!s) throw new NotFoundException('Scan not found');
    this.assertCanScan(user, s.type);
    if (s.status !== 'NEEDS_REVIEW') throw new ConflictException(`Scan is ${s.status.toLowerCase()}, it cannot be edited`);
    const productIds = [...new Set(edits.map((e) => e.productId).filter((x): x is string => !!x))];
    if (productIds.length) {
      const n = await this.db.product.count({ where: { shopId: user.shopId, id: { in: productIds } } });
      if (n !== productIds.length) throw new NotFoundException('A selected product was not found');
    }
    const existing = new Map(s.lines.map((l) => [l.id, l]));
    let nextLineNo = s.lines.reduce((m, l) => Math.max(m, l.lineNo), 0);
    const keep = new Set(edits.map((e) => e.id).filter(Boolean));
    await this.db.$transaction(async (tx) => {
      for (const l of s.lines) if (!keep.has(l.id) && !l.deleted) await tx.scanLine.update({ where: { id: l.id }, data: { deleted: true } });
      for (const e of edits) {
        const old = e.id ? existing.get(e.id) : undefined;
        if (e.id && !old) throw new NotFoundException('Line not found');
        const unit = e.unit ? normalizeUnit(e.unit) : null;
        const flags = (old?.flags ?? []).filter((f) => {
          if (['MISSING_QTY', 'BAD_NUMBER'].includes(f)) return e.qtyMilli == null;
          if (f === 'MISSING_RATE') return e.ratePaisa == null;
          if (f === 'UNKNOWN_UNIT') return !!e.unit && !unit;
          if (['NEW_PRODUCT', 'PICK_PRODUCT'].includes(f)) return !e.productId;
          return !['AMOUNT_MISMATCH', 'LOW_CONFIDENCE', 'DUPLICATE_SERIAL', 'RATE_FROM_LIST'].includes(f) || !changed(old, e);
        });
        if (e.unit && !unit && !flags.includes('UNKNOWN_UNIT')) flags.push('UNKNOWN_UNIT');
        const data = {
          // keep paper order; new rows go to the end
          lineNo: old?.lineNo ?? ++nextLineNo,
          serialNo: e.serialNo ?? old?.serialNo ?? null,
          page: e.page ?? old?.page ?? 1,
          rawName: e.rawName.trim(),
          qty: e.qtyMilli == null ? null : dec(e.qtyMilli),
          unit: unit ?? (e.unit ? e.unit : null),
          ratePaisa: e.ratePaisa == null ? null : big(e.ratePaisa),
          productId: e.productId,
          matchStatus: e.productId && e.productId !== old?.productId ? 'manual' : (old?.matchStatus ?? (e.productId ? 'manual' : 'new')),
          flags,
        };
        if (old) await tx.scanLine.update({ where: { id: old.id }, data });
        else await tx.scanLine.create({ data: { ...data, scanId: id, confidence: 1, lineTotalPaisa: null } });
      }
      await tx.scan.update({ where: { id }, data: { updatedAt: new Date() } });
    });
    return this.get(user, id);
  }

  async retry(user: AuthUser, id: string): Promise<ScanView> {
    const s = await this.db.scan.findFirst({ where: { id, shopId: user.shopId } });
    if (!s) throw new NotFoundException('Scan not found');
    this.assertCanScan(user, s.type);
    if (s.status !== 'FAILED') throw new ConflictException('Only a failed scan can be retried');
    await this.db.scan.update({ where: { id }, data: { status: 'PROCESSING', failureReason: null } });
    this.start(id);
    return this.get(user, id);
  }

  /** FR-AI-07: after a failure the user can continue by typing the rows. */
  async continueManually(user: AuthUser, id: string): Promise<ScanView> {
    const s = await this.db.scan.findFirst({ where: { id, shopId: user.shopId } });
    if (!s) throw new NotFoundException('Scan not found');
    this.assertCanScan(user, s.type);
    if (s.status !== 'FAILED') throw new ConflictException('Only a failed scan can continue manually');
    await this.db.scan.update({ where: { id }, data: { status: 'NEEDS_REVIEW', checkFlags: { push: 'MANUAL_ENTRY' } } });
    return this.get(user, id);
  }

  async discard(user: AuthUser, id: string): Promise<{ id: string; status: ScanStatus }> {
    const s = await this.db.scan.findFirst({ where: { id, shopId: user.shopId } });
    if (!s) throw new NotFoundException('Scan not found');
    this.assertCanScan(user, s.type);
    if (s.status === 'CONFIRMED') throw new ConflictException('A confirmed scan cannot be discarded; void its document instead');
    await this.db.scan.update({ where: { id }, data: { status: 'DISCARDED' } });
    await this.db.auditLog.create({ data: { shopId: user.shopId, userId: user.userId, action: 'scan.discard', entity: 'scan', entityId: id } });
    return { id, status: 'DISCARDED' };
  }

  /**
   * Confirm (FR-STK-01, BR-5): one transaction posts the document and marks the scan confirmed.
   * Corrected names are learned as aliases (FR-REV-05), per supplier for purchases (FR-PRD-08).
   * Confirming an already-confirmed scan returns its document (safe to retry).
   */
  async confirm(
    user: AuthUser,
    id: string,
    body: { partyId?: string | null; payments?: { mode: PayMode; amountPaisa: Paisa }[]; discountPaisa?: Paisa; allowNegative?: boolean; note?: string | null },
    idempotencyKey: string | null,
  ): Promise<DocumentView> {
    const s = await this.db.scan.findFirst({ where: { id, shopId: user.shopId } });
    if (!s) throw new NotFoundException('Scan not found');
    this.assertCanScan(user, s.type);
    if (s.status === 'CONFIRMED' && s.documentId) return this.documents.get(user.shopId, s.documentId);
    if (s.status !== 'NEEDS_REVIEW') throw new ConflictException(`Scan is ${s.status.toLowerCase()}`);
    const view = await this.get(user, id);
    const problems = view.lines
      .map((l, i) => {
        if (!l.product) return `line ${i + 1} (${l.rawName}): choose or create the product`;
        if (l.qtyMilli == null || l.qtyMilli <= 0) return `line ${i + 1}: quantity is missing`;
        if (l.ratePaisa == null) return `line ${i + 1}: rate is missing`;
        const bad = l.flags.filter((f) => BLOCKING.has(f) && !(f === 'MISSING_RATE' && l.ratePaisa != null));
        return bad.length ? `line ${i + 1}: ${bad.join(', ').toLowerCase()}` : null;
      })
      .filter(Boolean);
    if (view.lines.length === 0) problems.push('add at least one line');
    if (problems.length) throw new BadRequestException({ code: 'REVIEW_INCOMPLETE', message: 'Fix these lines before confirming', problems });

    const docId = await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "scan" WHERE id = ${id}::uuid FOR UPDATE`;
        const fresh = await tx.scan.findUniqueOrThrow({ where: { id } });
        if (fresh.status === 'CONFIRMED' && fresh.documentId) return fresh.documentId;
        const lines = await tx.scanLine.findMany({ where: { scanId: id, deleted: false }, orderBy: { lineNo: 'asc' }, include: { product: true } });
        const docIdNew = await this.documents.postInTx(tx, user, {
          kind: s.type,
          partyId: body.partyId ?? null,
          lines: lines.map((l) => ({ productId: l.productId!, qtyMilli: milli(l.qty), unit: l.unit, ratePaisa: paisa(l.ratePaisa) })),
          discountPaisa: body.discountPaisa,
          payments: body.payments,
          allowNegative: body.allowNegative,
          idempotencyKey,
          scanId: id,
          note: body.note ?? null,
        });
        const aliasParty = s.type === 'PURCHASE' ? (body.partyId ?? null) : null;
        for (const l of lines) {
          const n = normalizeName(l.rawName);
          if (!n || !l.product || n === l.product.normalizedName) continue;
          const existing = await tx.productAlias.findFirst({ where: { productId: l.product.id, normalized: n, partyId: aliasParty } });
          if (existing) await tx.productAlias.update({ where: { id: existing.id }, data: { timesUsed: { increment: 1 } } });
          else await tx.productAlias.create({ data: { productId: l.product.id, text: l.rawName, normalized: n, partyId: aliasParty, timesUsed: 1 } });
        }
        return docIdNew;
      },
      { timeout: 30_000 },
    );
    return this.documents.get(user.shopId, docId);
  }
}

function changed(old: { qty: Prisma.Decimal | null; ratePaisa: bigint | null; rawName: string } | undefined, e: LineEdit): boolean {
  if (!old) return true;
  return (old.qty == null ? null : milli(old.qty)) !== e.qtyMilli || (old.ratePaisa == null ? null : paisa(old.ratePaisa)) !== e.ratePaisa || old.rawName !== e.rawName.trim();
}

/** FR-REV-14: rows that need attention first (lowest confidence first), then paper order. */
function orderForReview(lines: ScanLineView[]): ScanLineView[] {
  const needs = (l: ScanLineView) => l.flags.length > 0 || !l.product || l.shortStock;
  return [...lines].sort((a, b) => {
    if (needs(a) !== needs(b)) return needs(a) ? -1 : 1;
    if (needs(a) && a.confidence !== b.confidence) return a.confidence - b.confidence;
    return a.lineNo - b.lineNo;
  });
}
