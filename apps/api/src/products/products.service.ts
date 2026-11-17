import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizeName, normalizeUnit, toMilli, unitCost, type Paisa, type QtyMilli, type UnitCode } from '@erp/domain';
import type { AuthUser } from '../auth/decorators.js';
import { big, dec, milli, paisa } from '../common/convert.js';
import { nextNumber } from '../common/counters.js';
import { readSettings } from '../common/shop-settings.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ProductView {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  category: string | null;
  baseUnit: string;
  purchasePricePaisa: Paisa;
  salePricePaisa: Paisa;
  wholesalePricePaisa: Paisa | null;
  onHandMilli: QtyMilli;
  minLevelMilli: QtyMilli;
  /** Weighted average cost per base unit (BR-2) */
  avgCostPaisa: Paisa;
  stockValuePaisa: Paisa;
  /** BR-4 */
  lowStock: boolean;
  active: boolean;
  aliases: string[];
  units: { unit: string; factorToBase: number }[];
}

export interface ProductInput {
  name: string;
  categoryId?: string | null;
  baseUnit?: string;
  purchasePricePaisa?: Paisa;
  salePricePaisa?: Paisa;
  wholesalePricePaisa?: Paisa | null;
  minLevel?: number;
  aliases?: string[];
  units?: { unit: string; factorToBase: number }[];
  active?: boolean;
}

const include = { category: true, aliases: true, units: true } satisfies Prisma.ProductInclude;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof include }>;

export function toView(p: ProductRow): ProductView {
  const onHand = milli(p.onHand);
  const minLevel = milli(p.minLevel);
  const state = { onHandMilli: onHand, valuePaisa: paisa(p.stockValuePaisa), lastUnitCostPaisa: paisa(p.lastUnitCostPaisa) };
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    categoryId: p.categoryId,
    category: p.category?.name ?? null,
    baseUnit: p.baseUnit,
    purchasePricePaisa: paisa(p.purchasePricePaisa),
    salePricePaisa: paisa(p.salePricePaisa),
    wholesalePricePaisa: p.wholesalePricePaisa == null ? null : paisa(p.wholesalePricePaisa),
    onHandMilli: onHand,
    minLevelMilli: minLevel,
    avgCostPaisa: unitCost(state),
    stockValuePaisa: paisa(p.stockValuePaisa),
    lowStock: onHand <= minLevel,
    active: p.active,
    aliases: p.aliases.map((a) => a.text),
    units: p.units.map((u) => ({ unit: u.unit, factorToBase: Number(u.factorToBase) })),
  };
}

function unitOrThrow(raw: string): UnitCode {
  const u = normalizeUnit(raw);
  if (!u) throw new RangeError(`unknown unit "${raw}"`);
  return u;
}

@Injectable()
export class ProductsService {
  constructor(private readonly db: PrismaService) {}

  /** FR-PRD-02: search by name, alias or SKU with typo tolerance (pg_trgm); filter by category or low stock. */
  async list(shopId: string, f: { q?: string; categoryId?: string; lowStock?: boolean; includeInactive?: boolean; limit?: number }): Promise<ProductView[]> {
    const limit = Math.min(f.limit ?? 100, 500);
    const where: Prisma.ProductWhereInput = { shopId, ...(f.includeInactive ? {} : { active: true }), ...(f.categoryId ? { categoryId: f.categoryId } : {}) };
    let rows: ProductRow[];
    const q = f.q ? normalizeName(f.q) : '';
    if (q) {
      const hits = await this.db.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM "product" p
        WHERE p."shopId" = ${shopId}::uuid
          AND (p."normalizedName" LIKE ${'%' + q + '%'} OR similarity(p."normalizedName", ${q}) > 0.2 OR p.sku ILIKE ${q}
               OR EXISTS (SELECT 1 FROM "product_alias" a WHERE a."productId" = p.id AND (a.normalized LIKE ${'%' + q + '%'} OR similarity(a.normalized, ${q}) > 0.3)))
        ORDER BY greatest(similarity(p."normalizedName", ${q}),
                          coalesce((SELECT max(similarity(a.normalized, ${q})) FROM "product_alias" a WHERE a."productId" = p.id), 0)) DESC
        LIMIT ${limit}`;
      const ids = hits.map((h) => h.id);
      const found = await this.db.product.findMany({ where: { ...where, id: { in: ids } }, include });
      const order = new Map(ids.map((id, i) => [id, i]));
      rows = found.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } else {
      rows = await this.db.product.findMany({ where, include, orderBy: { name: 'asc' }, take: f.lowStock ? undefined : limit });
    }
    const views = rows.map(toView);
    return f.lowStock ? views.filter((v) => v.lowStock).slice(0, limit) : views;
  }

  async get(shopId: string, id: string): Promise<ProductView> {
    const p = await this.db.product.findFirst({ where: { id, shopId }, include });
    if (!p) throw new NotFoundException('Product not found');
    return toView(p);
  }

  /** FR-PRD-01/03, FR-REV-10 (new products from review get a category and sale price). */
  async create(user: AuthUser, input: ProductInput): Promise<ProductView> {
    const name = input.name.trim();
    const normalized = normalizeName(name);
    if (!normalized) throw new RangeError('product name is empty');
    const baseUnit = unitOrThrow(input.baseUnit ?? 'pcs');
    const shop = await this.db.shop.findUniqueOrThrow({ where: { id: user.shopId } });
    const settings = readSettings(shop.settings);
    if (input.categoryId) await this.assertCategory(user.shopId, input.categoryId);
    const purchase = input.purchasePricePaisa ?? 0;
    const sale = input.salePricePaisa ?? Math.round((purchase * (100 + settings.markupPct)) / 100 / 1000) * 1000;

    const created = await this.db.$transaction(async (tx) => {
      const n = await nextNumber(tx, user.shopId, 'SKU');
      const p = await tx.product.create({
        data: {
          shopId: user.shopId,
          categoryId: input.categoryId ?? null,
          sku: `P-${String(n).padStart(5, '0')}`,
          name,
          normalizedName: normalized,
          baseUnit,
          purchasePricePaisa: big(purchase),
          salePricePaisa: big(sale),
          wholesalePricePaisa: input.wholesalePricePaisa == null ? null : big(input.wholesalePricePaisa),
          minLevel: dec(toMilli(input.minLevel ?? settings.lowStockDefault)),
          units: { create: (input.units ?? []).map((u) => ({ unit: unitOrThrow(u.unit), factorToBase: new Prisma.Decimal(u.factorToBase) })) },
          aliases: { create: [...new Set((input.aliases ?? []).map((a) => a.trim()).filter(Boolean))].map((text) => ({ text, normalized: normalizeName(text) })) },
        },
        include,
      });
      await tx.auditLog.create({ data: { shopId: user.shopId, userId: user.userId, action: 'product.create', entity: 'product', entityId: p.id, after: { name, sku: p.sku } } });
      return p;
    });
    return toView(created);
  }

  /** FR-PRD-03/04: prices changed here are written to price history. */
  async update(user: AuthUser, id: string, input: Partial<ProductInput>): Promise<ProductView> {
    const before = await this.db.product.findFirst({ where: { id, shopId: user.shopId } });
    if (!before) throw new NotFoundException('Product not found');
    if (input.categoryId) await this.assertCategory(user.shopId, input.categoryId);
    const updated = await this.db.$transaction(async (tx) => {
      const data: Prisma.ProductUpdateInput = {};
      if (input.name !== undefined) {
        data.name = input.name.trim();
        data.normalizedName = normalizeName(input.name);
      }
      if (input.categoryId !== undefined) data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true };
      if (input.baseUnit !== undefined) {
        if (milli(before.onHand) !== 0) throw new RangeError('base unit can only change while stock is zero');
        data.baseUnit = unitOrThrow(input.baseUnit);
      }
      if (input.minLevel !== undefined) data.minLevel = dec(toMilli(input.minLevel));
      if (input.active !== undefined) data.active = input.active;
      if (input.wholesalePricePaisa !== undefined) data.wholesalePricePaisa = input.wholesalePricePaisa == null ? null : big(input.wholesalePricePaisa);
      for (const [field, type] of [['purchasePricePaisa', 'PURCHASE'], ['salePricePaisa', 'SALE']] as const) {
        const v = input[field];
        if (v === undefined || BigInt(v) === before[field]) continue;
        data[field] = big(v);
        await tx.priceHistory.create({ data: { productId: id, type, oldPricePaisa: before[field], newPricePaisa: big(v) } });
      }
      const p = await tx.product.update({ where: { id }, data, include });
      await tx.auditLog.create({
        data: { shopId: user.shopId, userId: user.userId, action: 'product.update', entity: 'product', entityId: id, before: jsonSafe(before), after: jsonSafe(input) },
      });
      return p;
    });
    return toView(updated);
  }

  async priceHistory(shopId: string, id: string) {
    await this.get(shopId, id);
    const rows = await this.db.priceHistory.findMany({ where: { productId: id }, orderBy: { at: 'desc' }, take: 100 });
    return rows.map((r) => ({ type: r.type, oldPricePaisa: paisa(r.oldPricePaisa), newPricePaisa: paisa(r.newPricePaisa), at: r.at, documentId: r.documentId }));
  }

  async categories(shopId: string) {
    return this.db.category.findMany({ where: { shopId }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  }

  async createCategory(shopId: string, name: string) {
    return this.db.category.create({ data: { shopId, name: name.trim() }, select: { id: true, name: true } });
  }

  private async assertCategory(shopId: string, id: string): Promise<void> {
    if (!(await this.db.category.findFirst({ where: { id, shopId } }))) throw new NotFoundException('Category not found');
  }
}

/** BigInt and Decimal are not JSON; store them as strings in the audit log. */
export function jsonSafe(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) as Prisma.InputJsonValue;
}
