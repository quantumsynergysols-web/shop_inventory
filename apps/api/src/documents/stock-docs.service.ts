import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type DocKind as DbDocKind, type PayMode } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  assertDayOpen,
  can,
  lineAmount,
  mulDiv,
  normalizeName,
  normalizeUnit,
  postDocument,
  rupeesToPaisa,
  toMilli,
  type Movement,
  type Paisa,
  type QtyMilli,
  type StockState,
} from '@erp/domain';
import type { AuthUser } from '../auth/decorators.js';
import { big, businessDate, dateOnly, dec, milli, paisa } from '../common/convert.js';
import { DOC_PREFIX, formatNo, nextNumber } from '../common/counters.js';
import { readSettings } from '../common/shop-settings.js';
import { ACC, closedDates, moneyAccount } from '../parties/parties.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentsService, returnedByLine, type DocumentView } from './documents.service.js';

type Tx = Prisma.TransactionClient;

interface NewLine {
  lineNo: number;
  productId: string;
  qtyMilli: QtyMilli;
  unit: string;
  qtyBaseMilli: QtyMilli;
  ratePaisa: Paisa;
  amountPaisa: Paisa;
}

/** Locks the products and returns their stock (FR-STK-01: nobody else can post them until we commit). */
async function lockStock(tx: Tx, shopId: string, productIds: string[]) {
  await tx.$queryRaw`SELECT id FROM "product" WHERE "shopId" = ${shopId}::uuid AND id IN (${Prisma.join(productIds.map((id) => Prisma.sql`${id}::uuid`))}) FOR UPDATE`;
  const products = await tx.product.findMany({ where: { shopId, id: { in: productIds } } });
  if (products.length !== new Set(productIds).size) throw new NotFoundException('A product was not found');
  const stock = new Map<string, StockState>(products.map((p) => [p.id, { onHandMilli: milli(p.onHand), valuePaisa: paisa(p.stockValuePaisa), lastUnitCostPaisa: paisa(p.lastUnitCostPaisa) }]));
  return { products: new Map(products.map((p) => [p.id, p])), stock };
}

/** Writes a document, its lines with their stock movements, and the products' new stock. */
async function writeDoc(
  tx: Tx,
  user: AuthUser,
  d: { kind: DbDocKind; partyId: string | null; lines: NewLine[]; movements: Movement[]; stock: Map<string, StockState>; subtotalPaisa: Paisa; totalPaisa: Paisa; paidPaisa: Paisa; cogsPaisa: Paisa; reason: string | null; returnOfDocId?: string; idempotencyKey?: string | null },
): Promise<string> {
  const today = businessDate();
  const byLine = new Map(d.movements.map((m) => [m.lineNo, m]));
  const doc = await tx.document.create({
    data: {
      shopId: user.shopId,
      kind: d.kind,
      docNo: formatNo(DOC_PREFIX[d.kind]!, await nextNumber(tx, user.shopId, d.kind)),
      docDate: dateOnly(today),
      partyId: d.partyId,
      createdById: user.userId,
      payStatus: d.paidPaisa === 0 ? 'UNPAID' : d.paidPaisa < d.totalPaisa ? 'PART_PAID' : 'PAID',
      subtotalPaisa: big(d.subtotalPaisa),
      totalPaisa: big(d.totalPaisa),
      paidPaisa: big(d.paidPaisa),
      cogsPaisa: big(d.cogsPaisa),
      reason: d.reason,
      returnOfDocId: d.returnOfDocId ?? null,
      idempotencyKey: d.idempotencyKey ?? null,
      lines: {
        create: d.lines.map((l) => {
          const m = byLine.get(l.lineNo)!;
          return {
            lineNo: l.lineNo,
            productId: l.productId,
            qty: dec(l.qtyMilli),
            unit: l.unit,
            qtyBase: dec(l.qtyBaseMilli),
            ratePaisa: big(l.ratePaisa),
            amountPaisa: big(l.amountPaisa),
            movement: { create: { shopId: user.shopId, productId: l.productId, type: m.type, qtyBase: dec(m.qtyMilli), valuePaisa: big(m.valuePaisa), unitCostPaisa: big(m.unitCostPaisa), balanceAfter: dec(m.balanceAfterMilli) } },
          };
        }),
      },
    },
  });
  for (const [productId, s] of d.stock) {
    await tx.product.update({ where: { id: productId }, data: { onHand: dec(s.onHandMilli), stockValuePaisa: big(s.valuePaisa), lastUnitCostPaisa: big(s.lastUnitCostPaisa) } });
  }
  return doc.id;
}

function ledger(shopId: string, documentId: string) {
  const rows: Prisma.LedgerEntryCreateManyInput[] = [];
  const entryDate = dateOnly(businessDate());
  return {
    rows,
    add(account: string, debit: Paisa, credit: Paisa, partyId: string | null = null) {
      if (debit || credit) rows.push({ shopId, documentId, account, debitPaisa: big(debit), creditPaisa: big(credit), partyId, entryDate });
    },
  };
}

export interface ImportRow {
  row: number;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  qtyMilli: QtyMilli;
  costPaisa: Paisa;
  salePaisa: Paisa | null;
  minLevelMilli: QtyMilli | null;
  aliases: string[];
  status: 'new' | 'existing';
  productId: string | null;
  errors: string[];
}

export interface ImportPreview {
  rows: ImportRow[];
  okRows: number;
  errorRows: number;
  newProducts: number;
  stockValuePaisa: Paisa;
}

const HEADERS: Record<string, keyof RawRow> = {
  name: 'name', product: 'name', 'product name': 'name',
  sku: 'sku', code: 'sku',
  category: 'category',
  unit: 'unit', 'base unit': 'unit',
  qty: 'qty', quantity: 'qty', stock: 'qty', 'opening qty': 'qty',
  cost: 'cost', 'cost price': 'cost', 'purchase price': 'cost', rate: 'cost',
  'sale price': 'sale', sale: 'sale', price: 'sale',
  'min level': 'min', 'reorder level': 'min', min: 'min',
  aliases: 'aliases', alias: 'aliases',
};
interface RawRow {
  name: string;
  sku: string;
  category: string;
  unit: string;
  qty: string;
  cost: string;
  sale: string;
  min: string;
  aliases: string;
}

/** Splits one CSV line, with "quoted, values" and "" as an escaped quote. */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function readTable(bytes: Buffer, filename: string): Promise<string[][]> {
  if (/\.xlsx$/i.test(filename) || bytes.subarray(0, 2).toString('latin1') === 'PK') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const v = row.getCell(c).value;
        cells.push(v == null ? '' : typeof v === 'object' && 'text' in v ? String(v.text) : typeof v === 'object' && 'result' in v ? String(v.result ?? '') : String(v));
      }
      rows.push(cells);
    });
    return rows;
  }
  const text = bytes.toString('utf8').replace(/^﻿/, '');
  return text.split(/\r?\n/).filter((l) => l.trim()).map(csvCells);
}

@Injectable()
export class StockDocsService {
  constructor(
    private readonly db: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  /**
   * FR-STK-06: sales return (stock comes back at the cost it left with, BR-3) or purchase return
   * (stock goes back to the supplier at average cost). Quantities are per original line and can
   * never exceed what is left to return. The original document becomes partly or fully returned.
   */
  async createReturn(
    user: AuthUser,
    originalId: string,
    body: { lines: { lineNo: number; qtyMilli: QtyMilli }[]; refunds?: { mode: PayMode; amountPaisa: Paisa }[]; reason: string },
    idempotencyKey: string | null,
  ): Promise<DocumentView> {
    if (idempotencyKey) {
      const again = await this.db.document.findFirst({ where: { shopId: user.shopId, idempotencyKey } });
      if (again) return this.documents.get(user.shopId, again.id);
    }
    const id = await this.db.$transaction(
      async (tx) => {
        const shopId = user.shopId;
        const today = businessDate();
        assertDayOpen(today, await closedDates(tx, shopId, today));
        await tx.$queryRaw`SELECT id FROM "document" WHERE id = ${originalId}::uuid AND "shopId" = ${shopId}::uuid FOR UPDATE`;
        const orig = await tx.document.findFirst({ where: { id: originalId, shopId }, include: { lines: { include: { movement: true } }, party: true } });
        if (!orig) throw new NotFoundException('Document not found');
        if (orig.kind !== 'SALE' && orig.kind !== 'PURCHASE') throw new BadRequestException('Only a sale or a purchase can be returned');
        const kind = orig.kind === 'SALE' ? 'SALES_RETURN' : 'PURCHASE_RETURN';
        const action = kind === 'SALES_RETURN' ? 'return.sales' : 'return.purchase';
        if (!can(user.role, action)) throw new ForbiddenException(`Your role (${user.role}) cannot do ${action}`);
        if (orig.status !== 'POSTED' && orig.status !== 'PARTIALLY_RETURNED') throw new ConflictException(`This ${orig.kind.toLowerCase()} is ${orig.status.toLowerCase().replace('_', ' ')}`);

        const returned = await returnedByLine(tx, orig.id);
        const origLines = new Map(orig.lines.map((l) => [l.lineNo, l]));
        const asked = body.lines.filter((l) => l.qtyMilli > 0);
        if (asked.length === 0) throw new BadRequestException('Choose at least one item to return');
        if (new Set(asked.map((l) => l.lineNo)).size !== asked.length) throw new BadRequestException('A line is listed twice');
        const { stock } = await lockStock(tx, shopId, [...new Set(asked.map((l) => origLines.get(l.lineNo)?.productId ?? 'x'))].filter((x) => x !== 'x'));

        const lines: NewLine[] = [];
        const costs = new Map<number, Paisa>();
        for (const a of asked) {
          const ol = origLines.get(a.lineNo);
          if (!ol) throw new BadRequestException(`Line ${a.lineNo} is not on this bill`);
          const left = milli(ol.qty) - (returned.get(a.lineNo) ?? 0);
          if (a.qtyMilli > left) throw new BadRequestException(`Line ${a.lineNo}: only ${left / 1000} left to return`);
          const qtyBase = mulDiv(milli(ol.qtyBase), a.qtyMilli, milli(ol.qty));
          if (qtyBase <= 0) throw new BadRequestException(`Line ${a.lineNo}: quantity too small`);
          // Sales return: back in at the cost this line left with (BR-3), so profit reverses exactly.
          const value = mulDiv(Math.abs(paisa(ol.movement!.valuePaisa)), qtyBase, Math.abs(milli(ol.movement!.qtyBase)));
          costs.set(a.lineNo, mulDiv(value, 1000, qtyBase));
          lines.push({ lineNo: a.lineNo, productId: ol.productId, qtyMilli: a.qtyMilli, unit: ol.unit, qtyBaseMilli: qtyBase, ratePaisa: paisa(ol.ratePaisa), amountPaisa: lineAmount(a.qtyMilli, paisa(ol.ratePaisa)) });
        }
        const settings = readSettings((await tx.shop.findUniqueOrThrow({ where: { id: shopId } })).settings);
        const posted = postDocument(
          kind,
          lines.map((l) => ({ lineNo: l.lineNo, productId: l.productId, qtyBaseMilli: l.qtyBaseMilli, ...(kind === 'SALES_RETURN' ? { unitCostPaisa: costs.get(l.lineNo)! } : {}) })),
          stock,
          { allowNegative: settings.allowNegativeStock },
        );
        const subtotal = lines.reduce((s, l) => s + l.amountPaisa, 0);
        // The bill's discount is shared out in proportion, so the refund matches what was charged.
        const total = paisa(orig.subtotalPaisa) > 0 ? mulDiv(subtotal, paisa(orig.totalPaisa), paisa(orig.subtotalPaisa)) : subtotal;
        const refunds = (body.refunds ?? []).filter((r) => r.amountPaisa > 0);
        const refunded = refunds.reduce((s, r) => s + r.amountPaisa, 0);
        if (refunded > total) throw new BadRequestException('Refund is more than the return total');
        const walkIn = !orig.party || orig.party.name === 'Walk-in';
        if (kind === 'SALES_RETURN' && walkIn && refunded !== total) throw new BadRequestException(`A walk-in customer is refunded in full: Rs ${total / 100}`);
        const value = posted.movements.reduce((s, m) => s + Math.abs(m.valuePaisa), 0);

        const docId = await writeDoc(tx, user, {
          kind,
          partyId: orig.partyId,
          lines,
          movements: posted.movements,
          stock: posted.stock,
          subtotalPaisa: subtotal,
          totalPaisa: total,
          paidPaisa: refunded,
          cogsPaisa: value,
          reason: body.reason,
          returnOfDocId: orig.id,
          idempotencyKey,
        });
        const L = ledger(shopId, docId);
        for (const r of refunds) {
          await tx.payment.create({
            data: { shopId, partyId: orig.partyId!, documentId: docId, direction: kind === 'SALES_RETURN' ? 'PAID' : 'RECEIVED', amountPaisa: big(r.amountPaisa), mode: r.mode, paidOn: dateOnly(today), note: `Return of ${orig.docNo}` },
          });
          if (kind === 'SALES_RETURN') L.add(moneyAccount(r.mode), 0, r.amountPaisa);
          else L.add(moneyAccount(r.mode), r.amountPaisa, 0);
        }
        if (kind === 'SALES_RETURN') {
          L.add(ACC.SALES, total, 0);
          L.add(ACC.RECEIVABLE, 0, total - refunded, orig.partyId);
          L.add(ACC.INVENTORY, value, 0);
          L.add(ACC.COGS, 0, value);
        } else {
          L.add(ACC.PAYABLE, total - refunded, 0, orig.partyId);
          // Stock leaves at average cost; the gap to the bill price is a cost gain or loss.
          L.add(ACC.INVENTORY, 0, value);
          if (total > value) L.add(ACC.COGS, 0, total - value);
          else L.add(ACC.COGS, value - total, 0);
        }
        if (L.rows.length) await tx.ledgerEntry.createMany({ data: L.rows });

        const after = new Map(returned);
        for (const l of lines) after.set(l.lineNo, (after.get(l.lineNo) ?? 0) + l.qtyMilli);
        const full = orig.lines.every((l) => (after.get(l.lineNo) ?? 0) >= milli(l.qty));
        await tx.document.update({ where: { id: orig.id }, data: { status: full ? 'FULLY_RETURNED' : 'PARTIALLY_RETURNED' } });
        await tx.auditLog.create({ data: { shopId, userId: user.userId, action: `document.${kind.toLowerCase()}`, entity: 'document', entityId: docId, reason: body.reason, after: { of: orig.docNo, totalPaisa: total, refundedPaisa: refunded } } });
        return docId;
      },
      { timeout: 30_000 },
    );
    return this.documents.get(user.shopId, id);
  }

  /**
   * FR-STK-07 (and FR-STK-11 count sheets): owner corrects stock with a reason. A line gives either a
   * change (+/-) or the counted quantity; gains post as ADJUST_IN at average cost, losses as ADJUST_OUT.
   */
  async adjust(
    user: AuthUser,
    body: { reason: string; lines: { productId: string; deltaMilli?: QtyMilli; countedMilli?: QtyMilli }[] },
    idempotencyKey: string | null,
  ): Promise<DocumentView[]> {
    if (!can(user.role, 'stock.adjust')) throw new ForbiddenException('Only the owner can adjust stock');
    const keys = idempotencyKey ? [`${idempotencyKey}:in`, `${idempotencyKey}:out`] : [];
    if (keys.length) {
      const again = await this.db.document.findMany({ where: { shopId: user.shopId, idempotencyKey: { in: keys } } });
      if (again.length) return Promise.all(again.map((d) => this.documents.get(user.shopId, d.id)));
    }
    const ids = await this.db.$transaction(
      async (tx) => {
        const shopId = user.shopId;
        const today = businessDate();
        assertDayOpen(today, await closedDates(tx, shopId, today));
        if (new Set(body.lines.map((l) => l.productId)).size !== body.lines.length) throw new BadRequestException('A product is listed twice');
        const { products, stock } = await lockStock(tx, shopId, body.lines.map((l) => l.productId));
        const ins: NewLine[] = [];
        const outs: NewLine[] = [];
        for (const l of body.lines) {
          const p = products.get(l.productId)!;
          const onHand = milli(p.onHand);
          const delta = l.countedMilli != null ? l.countedMilli - onHand : (l.deltaMilli ?? 0);
          if (delta === 0) continue;
          const list = delta > 0 ? ins : outs;
          const qty = Math.abs(delta);
          list.push({ lineNo: list.length + 1, productId: p.id, qtyMilli: qty, unit: p.baseUnit, qtyBaseMilli: qty, ratePaisa: 0, amountPaisa: 0 });
        }
        if (!ins.length && !outs.length) throw new BadRequestException('Nothing to change: counted stock already matches');
        const settings = readSettings((await tx.shop.findUniqueOrThrow({ where: { id: shopId } })).settings);
        const made: string[] = [];
        let current = stock;
        for (const [kind, lines, key] of [['ADJUST_IN', ins, keys[0]], ['ADJUST_OUT', outs, keys[1]]] as const) {
          if (!lines.length) continue;
          const posted = postDocument(kind, lines.map((l) => ({ lineNo: l.lineNo, productId: l.productId, qtyBaseMilli: l.qtyBaseMilli })), current, { allowNegative: settings.allowNegativeStock });
          current = posted.stock;
          for (const m of posted.movements) {
            const l = lines.find((x) => x.lineNo === m.lineNo)!;
            l.ratePaisa = m.unitCostPaisa;
            l.amountPaisa = Math.abs(m.valuePaisa);
          }
          const value = lines.reduce((s, l) => s + l.amountPaisa, 0);
          const docId = await writeDoc(tx, user, { kind, partyId: null, lines, movements: posted.movements, stock: posted.stock, subtotalPaisa: value, totalPaisa: value, paidPaisa: 0, cogsPaisa: value, reason: body.reason, idempotencyKey: key ?? null });
          const L = ledger(shopId, docId);
          if (kind === 'ADJUST_IN') {
            L.add(ACC.INVENTORY, value, 0);
            L.add('STOCK_ADJUSTMENT', 0, value);
          } else {
            L.add('STOCK_ADJUSTMENT', value, 0);
            L.add(ACC.INVENTORY, 0, value);
          }
          if (L.rows.length) await tx.ledgerEntry.createMany({ data: L.rows });
          await tx.auditLog.create({ data: { shopId, userId: user.userId, action: `stock.${kind.toLowerCase()}`, entity: 'document', entityId: docId, reason: body.reason, after: { lines: lines.length, valuePaisa: value } } });
          made.push(docId);
        }
        return made;
      },
      { timeout: 30_000 },
    );
    return Promise.all(ids.map((id) => this.documents.get(user.shopId, id)));
  }

  /** FR-STK-08: read and check an opening-stock file (CSV or Excel). Nothing is saved. */
  async previewOpening(user: AuthUser, bytes: Buffer, filename: string): Promise<ImportPreview> {
    if (!can(user.role, 'stock.import_opening')) throw new ForbiddenException('Only the owner can import opening stock');
    const table = await readTable(bytes, filename);
    if (table.length < 2) throw new BadRequestException('The file needs a header row and at least one product');
    const header = table[0]!.map((h) => HEADERS[h.trim().toLowerCase()] ?? null);
    if (!header.includes('name') || !header.includes('qty')) throw new BadRequestException('The file needs at least the columns "name" and "qty" (see the template)');
    if (table.length > 5001) throw new BadRequestException('At most 5,000 products per file');

    const products = await this.db.product.findMany({ where: { shopId: user.shopId }, select: { id: true, sku: true, normalizedName: true, _count: { select: { movements: true } } } });
    const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
    const byName = new Map(products.map((p) => [p.normalizedName, p]));
    const seen = new Set<string>();
    const rows: ImportRow[] = [];
    for (const [i, cells] of table.slice(1).entries()) {
      const raw = {} as RawRow;
      header.forEach((k, c) => {
        if (k) raw[k] = (cells[c] ?? '').trim();
      });
      if (Object.values(raw).every((v) => !v)) continue;
      const errors: string[] = [];
      const num = <T,>(label: string, v: string | undefined, f: (s: string) => T): T | null => {
        if (!v) return null;
        try {
          const n = f(v.replace(/,/g, ''));
          if (typeof n === 'number' && n < 0) throw new RangeError();
          return n;
        } catch {
          errors.push(`${label} "${v}" is not a valid number`);
          return null;
        }
      };
      const name = raw.name ?? '';
      if (!name) errors.push('name is empty');
      const unit = raw.unit ? normalizeUnit(raw.unit) : 'pcs';
      if (!unit) errors.push(`unit "${raw.unit}" is not known (pcs, box, dozen, metre, foot, kg, set, roll, packet)`);
      const qty = num('qty', raw.qty, toMilli);
      if (raw.qty == null || raw.qty === '') errors.push('qty is empty');
      const cost = num('cost', raw.cost, rupeesToPaisa);
      if ((qty ?? 0) > 0 && cost == null) errors.push('cost is needed when qty is more than 0');
      const sale = num('sale price', raw.sale, rupeesToPaisa);
      const min = num('min level', raw.min, toMilli);
      const norm = normalizeName(name);
      if (norm && seen.has(norm)) errors.push('same product appears twice in the file');
      seen.add(norm);
      const match = (raw.sku && bySku.get(raw.sku.toLowerCase())) || byName.get(norm);
      if (match && match._count.movements > 0) errors.push('this product already has stock entries; use a stock adjustment instead');
      rows.push({
        row: i + 2,
        name,
        sku: raw.sku || null,
        category: raw.category || null,
        unit: unit ?? 'pcs',
        qtyMilli: qty ?? 0,
        costPaisa: cost ?? 0,
        salePaisa: sale,
        minLevelMilli: min,
        aliases: (raw.aliases ?? '').split(';').map((a) => a.trim()).filter(Boolean),
        status: match ? 'existing' : 'new',
        productId: match?.id ?? null,
        errors,
      });
    }
    const ok = rows.filter((r) => !r.errors.length);
    return {
      rows,
      okRows: ok.length,
      errorRows: rows.length - ok.length,
      newProducts: ok.filter((r) => r.status === 'new').length,
      stockValuePaisa: ok.reduce((s, r) => s + lineAmount(r.qtyMilli, r.costPaisa), 0),
    };
  }

  /** FR-STK-08: create the missing products and post one OPENING document; all or nothing. */
  async importOpening(user: AuthUser, bytes: Buffer, filename: string): Promise<{ preview: ImportPreview; document: DocumentView | null }> {
    const preview = await this.previewOpening(user, bytes, filename);
    if (preview.errorRows) throw new BadRequestException({ code: 'IMPORT_ERRORS', message: `${preview.errorRows} row(s) have errors; fix them and upload again`, preview });
    if (!preview.rows.length) throw new BadRequestException('No products in the file');
    const docId = await this.db.$transaction(
      async (tx) => {
        const shopId = user.shopId;
        const today = businessDate();
        assertDayOpen(today, await closedDates(tx, shopId, today));
        const settings = readSettings((await tx.shop.findUniqueOrThrow({ where: { id: shopId } })).settings);
        const cats = new Map((await tx.category.findMany({ where: { shopId } })).map((c) => [c.name.toLowerCase(), c.id]));
        const ids: string[] = [];
        for (const r of preview.rows) {
          let catId: string | null = null;
          if (r.category) {
            catId = cats.get(r.category.toLowerCase()) ?? null;
            if (!catId) {
              catId = (await tx.category.create({ data: { shopId, name: r.category } })).id;
              cats.set(r.category.toLowerCase(), catId);
            }
          }
          if (r.productId) {
            await tx.product.update({
              where: { id: r.productId },
              data: { purchasePricePaisa: big(r.costPaisa), ...(r.salePaisa != null ? { salePricePaisa: big(r.salePaisa) } : {}), ...(r.minLevelMilli != null ? { minLevel: dec(r.minLevelMilli) } : {}), ...(catId ? { categoryId: catId } : {}) },
            });
            ids.push(r.productId);
          } else {
            const sku = r.sku ?? `P-${String(await nextNumber(tx, shopId, 'SKU')).padStart(5, '0')}`;
            const p = await tx.product.create({
              data: {
                shopId,
                sku,
                name: r.name,
                normalizedName: normalizeName(r.name),
                categoryId: catId,
                baseUnit: r.unit,
                purchasePricePaisa: big(r.costPaisa),
                salePricePaisa: big(r.salePaisa ?? Math.round((r.costPaisa * (100 + settings.markupPct)) / 100 / 1000) * 1000),
                minLevel: dec(r.minLevelMilli ?? toMilli(settings.lowStockDefault)),
                aliases: { create: [...new Set(r.aliases)].map((text) => ({ text, normalized: normalizeName(text) })) },
              },
            });
            ids.push(p.id);
          }
        }
        const withQty = preview.rows.map((r, i) => ({ r, productId: ids[i]! })).filter((x) => x.r.qtyMilli > 0);
        if (!withQty.length) return null;
        const { stock } = await lockStock(tx, shopId, withQty.map((x) => x.productId));
        const lines: NewLine[] = withQty.map((x, i) => ({ lineNo: i + 1, productId: x.productId, qtyMilli: x.r.qtyMilli, unit: x.r.unit, qtyBaseMilli: x.r.qtyMilli, ratePaisa: x.r.costPaisa, amountPaisa: lineAmount(x.r.qtyMilli, x.r.costPaisa) }));
        const posted = postDocument('OPENING', lines.map((l) => ({ lineNo: l.lineNo, productId: l.productId, qtyBaseMilli: l.qtyBaseMilli, unitCostPaisa: l.ratePaisa })), stock);
        const total = lines.reduce((s, l) => s + l.amountPaisa, 0);
        const id = await writeDoc(tx, user, { kind: 'OPENING', partyId: null, lines, movements: posted.movements, stock: posted.stock, subtotalPaisa: total, totalPaisa: total, paidPaisa: 0, cogsPaisa: 0, reason: `Opening stock import (${filename.slice(0, 100)})` });
        const L = ledger(shopId, id);
        L.add(ACC.INVENTORY, total, 0);
        L.add('OPENING_BALANCE', 0, total);
        await tx.ledgerEntry.createMany({ data: L.rows });
        await tx.auditLog.create({ data: { shopId, userId: user.userId, action: 'stock.import_opening', entity: 'document', entityId: id, after: { rows: preview.rows.length, newProducts: preview.newProducts, valuePaisa: total } } });
        return id;
      },
      { timeout: 120_000 },
    );
    return { preview, document: docId ? await this.documents.get(user.shopId, docId) : null };
  }
}

/** CSV template for the opening-stock import (FR-STK-08). */
export const OPENING_TEMPLATE =
  '﻿name,sku,category,unit,qty,cost,sale price,min level,aliases\r\n' +
  'PVC Pipe 1 inch – 10 ft,,Plumbing,pcs,20,450,650,15,pvc pipe 1"\r\n' +
  'Copper Wire 7/29 – coil,,Electrical,roll,3,9800,11500,5,7/29 taar\r\n';
