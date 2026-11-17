import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type DocKind as DbDocKind, type PayMode } from '@prisma/client';
import {
  assertDayOpen,
  can,
  lineAmount,
  mulDiv,
  normalizeUnit,
  postDocument,
  reverseMovements,
  toBaseQty,
  type Movement,
  type Paisa,
  type QtyMilli,
  type StockState,
  type UnitCode,
} from '@erp/domain';
import type { AuthUser } from '../auth/decorators.js';
import { big, businessDate, dateOnly, dec, milli, paisa } from '../common/convert.js';
import { DOC_PREFIX, formatNo, nextNumber } from '../common/counters.js';
import { readSettings } from '../common/shop-settings.js';
import { ACC, closedDates, moneyAccount } from '../parties/parties.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type PostKind = 'PURCHASE' | 'SALE';

export interface PostLineInput {
  productId: string;
  /** Quantity in `unit`, thousandths */
  qtyMilli: QtyMilli;
  /** Unit written on the bill; null = product's base unit */
  unit?: string | null;
  /** Price per `unit` in paisa */
  ratePaisa: Paisa;
}

export interface PostInput {
  kind: PostKind;
  partyId?: string | null;
  lines: PostLineInput[];
  discountPaisa?: Paisa;
  /** Money received (sale) or paid (purchase) now; the rest is udhaar / payable */
  payments?: { mode: PayMode; amountPaisa: Paisa }[];
  /** NFR-REL-02: a retry with the same key returns the first result */
  idempotencyKey?: string | null;
  /** Owner may sell beyond stock only when the shop setting allows it (FR-REV-07) */
  allowNegative?: boolean;
  /** Set when the document comes from a confirmed scan (BR-5) */
  scanId?: string | null;
  note?: string | null;
}

export interface DocumentLineView {
  lineNo: number;
  productId: string;
  productName: string;
  sku: string;
  qtyMilli: QtyMilli;
  unit: string;
  qtyBaseMilli: QtyMilli;
  ratePaisa: Paisa;
  amountPaisa: Paisa;
  /** Signed stock movement in base units */
  movedMilli: QtyMilli;
  unitCostPaisa: Paisa;
  stockAfterMilli: QtyMilli;
  stockBeforeMilli: QtyMilli;
  lowStock: boolean;
}

export interface DocumentView {
  id: string;
  kind: DbDocKind;
  docNo: string;
  docDate: string;
  status: string;
  payStatus: string;
  party: { id: string; name: string; phone: string | null } | null;
  subtotalPaisa: Paisa;
  discountPaisa: Paisa;
  totalPaisa: Paisa;
  paidPaisa: Paisa;
  balanceDuePaisa: Paisa;
  cogsPaisa: Paisa;
  receiptNo: string | null;
  voidsDocId: string | null;
  voidedById: string | null;
  reason: string | null;
  payments: { mode: PayMode; amountPaisa: Paisa }[];
  lines: DocumentLineView[];
  createdBy: string;
  postedAt: Date;
  scanId: string | null;
}

const docInclude = {
  party: true,
  createdBy: { select: { name: true } },
  receipt: true,
  payments: true,
  scan: { select: { id: true } },
  voidedBy: { select: { id: true } },
  lines: { orderBy: { lineNo: 'asc' }, include: { movement: true, product: { select: { name: true, sku: true, minLevel: true } } } },
} satisfies Prisma.DocumentInclude;
type DocRow = Prisma.DocumentGetPayload<{ include: typeof docInclude }>;

function toView(d: DocRow): DocumentView {
  const lines = d.lines.map((l) => {
    const moved = milli(l.movement?.qtyBase);
    const after = milli(l.movement?.balanceAfter);
    return {
      lineNo: l.lineNo,
      productId: l.productId,
      productName: l.product.name,
      sku: l.product.sku,
      qtyMilli: milli(l.qty),
      unit: l.unit,
      qtyBaseMilli: milli(l.qtyBase),
      ratePaisa: paisa(l.ratePaisa),
      amountPaisa: paisa(l.amountPaisa),
      movedMilli: moved,
      unitCostPaisa: paisa(l.movement?.unitCostPaisa),
      stockAfterMilli: after,
      stockBeforeMilli: after - moved,
      lowStock: after <= milli(l.product.minLevel),
    };
  });
  return {
    id: d.id,
    kind: d.kind,
    docNo: d.docNo,
    docDate: d.docDate.toISOString().slice(0, 10),
    status: d.status,
    payStatus: d.payStatus,
    party: d.party ? { id: d.party.id, name: d.party.name, phone: d.party.phone } : null,
    subtotalPaisa: paisa(d.subtotalPaisa),
    discountPaisa: paisa(d.discountPaisa),
    totalPaisa: paisa(d.totalPaisa),
    paidPaisa: paisa(d.paidPaisa),
    balanceDuePaisa: paisa(d.totalPaisa) - paisa(d.paidPaisa),
    cogsPaisa: paisa(d.cogsPaisa),
    receiptNo: d.receipt?.receiptNo ?? null,
    voidsDocId: d.voidsDocId,
    voidedById: d.voidedBy?.id ?? null,
    reason: d.reason,
    payments: d.payments.map((p) => ({ mode: p.mode, amountPaisa: paisa(p.amountPaisa) })),
    lines,
    createdBy: d.createdBy.name,
    postedAt: d.postedAt,
    scanId: d.scan?.id ?? null,
  };
}

const sum = (xs: readonly { amountPaisa: Paisa }[]) => xs.reduce((s, x) => s + x.amountPaisa, 0);

@Injectable()
export class DocumentsService {
  constructor(private readonly db: PrismaService) {}

  async get(shopId: string, id: string): Promise<DocumentView> {
    const d = await this.db.document.findFirst({ where: { id, shopId }, include: docInclude });
    if (!d) throw new NotFoundException('Document not found');
    return toView(d);
  }

  async list(shopId: string, f: { kind?: DbDocKind; partyId?: string; from?: string; to?: string; limit?: number }): Promise<DocumentView[]> {
    const rows = await this.db.document.findMany({
      where: {
        shopId,
        ...(f.kind ? { kind: f.kind } : {}),
        ...(f.partyId ? { partyId: f.partyId } : {}),
        ...(f.from || f.to ? { docDate: { ...(f.from ? { gte: dateOnly(f.from) } : {}), ...(f.to ? { lte: dateOnly(f.to) } : {}) } } : {}),
      },
      include: docInclude,
      orderBy: { postedAt: 'desc' },
      take: Math.min(f.limit ?? 50, 200),
    });
    return rows.map(toView);
  }

  /** Purchase (Stock IN) or sale (Stock OUT), manual or from a confirmed scan. SRS §3.5, FR-STK-01..04, FR-STK-09. */
  async post(user: AuthUser, input: PostInput): Promise<DocumentView> {
    const action = input.kind === 'SALE' ? 'sale.create' : 'purchase.create';
    if (!can(user.role, action)) throw new ForbiddenException(`Your role (${user.role}) cannot do ${action}`);
    if (input.lines.length === 0) throw new BadRequestException('Add at least one line');
    if (input.idempotencyKey) {
      const existing = await this.db.document.findFirst({ where: { shopId: user.shopId, idempotencyKey: input.idempotencyKey }, include: docInclude });
      if (existing) return toView(existing);
    }
    try {
      const id = await this.db.$transaction((tx) => this.postInTx(tx, user, input), { timeout: 30_000 });
      return this.get(user.shopId, id);
    } catch (e) {
      // Two taps at once: the second insert hits the unique key; answer with the first document.
      if (input.idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.db.document.findFirst({ where: { shopId: user.shopId, idempotencyKey: input.idempotencyKey }, include: docInclude });
        if (existing) return toView(existing);
      }
      throw e;
    }
  }

  /** Runs inside the caller's transaction; returns the new document id. Used by scan confirm too. */
  async postInTx(tx: Prisma.TransactionClient, user: AuthUser, input: PostInput): Promise<string> {
    const shopId = user.shopId;
    const today = businessDate();
    assertDayOpen(today, await closedDates(tx, shopId, today));
    const shop = await tx.shop.findUniqueOrThrow({ where: { id: shopId } });
    const settings = readSettings(shop.settings);
    const allowNegative = input.kind === 'SALE' && !!input.allowNegative && settings.allowNegativeStock && user.role === 'OWNER';

    // Party (FR-REV-06): purchases need a supplier; sales default to Walk-in, but udhaar needs a named customer.
    let partyId = input.partyId ?? null;
    if (partyId) {
      const party = await tx.party.findFirst({ where: { id: partyId, shopId } });
      if (!party) throw new NotFoundException('Party not found');
      const okType = input.kind === 'SALE' ? party.type !== 'SUPPLIER' : party.type !== 'CUSTOMER';
      if (!okType) throw new BadRequestException(`${party.name} is not a ${input.kind === 'SALE' ? 'customer' : 'supplier'}`);
    } else if (input.kind === 'PURCHASE') {
      throw new BadRequestException('Select the supplier');
    } else {
      const walkIn = await tx.party.findFirst({ where: { shopId, name: 'Walk-in', type: 'CUSTOMER' } });
      partyId = walkIn?.id ?? null;
    }
    const walkInId = partyId ? (await tx.party.findFirst({ where: { id: partyId, shopId, name: 'Walk-in' } }))?.id : undefined;

    // Lock the products so two confirms cannot both sell the last unit.
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    await tx.$queryRaw`SELECT id FROM "product" WHERE "shopId" = ${shopId}::uuid AND id IN (${Prisma.join(productIds.map((id) => Prisma.sql`${id}::uuid`))}) FOR UPDATE`;
    const products = await tx.product.findMany({ where: { shopId, id: { in: productIds } }, include: { units: true } });
    if (products.length !== productIds.length) throw new NotFoundException('A product on this bill was not found');
    const byId = new Map(products.map((p) => [p.id, p]));
    const stock = new Map<string, StockState>(
      products.map((p) => [p.id, { onHandMilli: milli(p.onHand), valuePaisa: paisa(p.stockValuePaisa), lastUnitCostPaisa: paisa(p.lastUnitCostPaisa) }]),
    );

    const prepared = input.lines.map((l, i) => {
      const p = byId.get(l.productId)!;
      if (!p.active) throw new BadRequestException(`${p.name} is inactive`);
      if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0) throw new BadRequestException(`Line ${i + 1}: quantity must be more than 0`);
      if (!Number.isSafeInteger(l.ratePaisa) || l.ratePaisa < 0) throw new BadRequestException(`Line ${i + 1}: rate must be 0 or more`);
      const base = normalizeUnit(p.baseUnit) as UnitCode;
      const unit = l.unit ? normalizeUnit(l.unit) : base;
      if (!unit) throw new BadRequestException(`Line ${i + 1}: unknown unit "${l.unit}"`);
      const qtyBase = toBaseQty(l.qtyMilli, unit, { baseUnit: base, conversions: p.units.map((u) => ({ unit: normalizeUnit(u.unit) as UnitCode, factorToBase: Number(u.factorToBase) })) });
      const amount = lineAmount(l.qtyMilli, l.ratePaisa);
      return { lineNo: i + 1, product: p, unit, qtyMilli: l.qtyMilli, qtyBase, rate: l.ratePaisa, amount, unitCostPaisa: mulDiv(amount, 1000, qtyBase) };
    });

    const result = postDocument(
      input.kind,
      prepared.map((l) => ({ lineNo: l.lineNo, productId: l.product.id, qtyBaseMilli: l.qtyBase, ...(input.kind === 'PURCHASE' ? { unitCostPaisa: l.unitCostPaisa } : {}) })),
      stock,
      { allowNegative },
    );

    const subtotal = prepared.reduce((s, l) => s + l.amount, 0);
    const discount = input.discountPaisa ?? 0;
    if (discount < 0 || discount > subtotal) throw new BadRequestException('Discount must be between 0 and the bill total');
    const total = subtotal - discount;
    const payments = (input.payments ?? []).filter((p) => p.amountPaisa > 0);
    const paid = sum(payments);
    if (paid > total) throw new BadRequestException('Paid amount is more than the bill total');
    if (input.kind === 'SALE' && paid < total && (!partyId || partyId === walkInId)) throw new BadRequestException('Select a customer for udhaar (credit)');

    const prefix = DOC_PREFIX[input.kind]!;
    const docNo = formatNo(prefix, await nextNumber(tx, shopId, input.kind));
    const moveByLine = new Map<number, Movement>(result.movements.map((m) => [m.lineNo, m]));
    const doc = await tx.document.create({
      data: {
        shopId,
        kind: input.kind,
        docNo,
        docDate: dateOnly(today),
        partyId,
        createdById: user.userId,
        payStatus: paid === 0 ? 'UNPAID' : paid < total ? 'PART_PAID' : 'PAID',
        subtotalPaisa: big(subtotal),
        discountPaisa: big(discount),
        totalPaisa: big(total),
        paidPaisa: big(paid),
        cogsPaisa: big(result.cogsPaisa),
        reason: input.note ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        lines: {
          create: prepared.map((l) => {
            const m = moveByLine.get(l.lineNo)!;
            return {
              lineNo: l.lineNo,
              productId: l.product.id,
              qty: dec(l.qtyMilli),
              unit: l.unit,
              qtyBase: dec(l.qtyBase),
              ratePaisa: big(l.rate),
              amountPaisa: big(l.amount),
              movement: {
                create: { shopId, productId: l.product.id, type: m.type, qtyBase: dec(m.qtyMilli), valuePaisa: big(m.valuePaisa), unitCostPaisa: big(m.unitCostPaisa), balanceAfter: dec(m.balanceAfterMilli) },
              },
            };
          }),
        },
      },
    });

    // Cached stock on the product (FR-STK-02) and purchase price update with history (FR-REV-09).
    for (const [productId, s] of result.stock) {
      const p = byId.get(productId)!;
      const data: Prisma.ProductUpdateInput = { onHand: dec(s.onHandMilli), stockValuePaisa: big(s.valuePaisa), lastUnitCostPaisa: big(s.lastUnitCostPaisa) };
      if (input.kind === 'PURCHASE') {
        const last = [...prepared].reverse().find((l) => l.product.id === productId)!;
        if (BigInt(last.unitCostPaisa) !== p.purchasePricePaisa) {
          data.purchasePricePaisa = big(last.unitCostPaisa);
          await tx.priceHistory.create({ data: { productId, documentId: doc.id, type: 'PURCHASE', oldPricePaisa: p.purchasePricePaisa, newPricePaisa: big(last.unitCostPaisa) } });
        }
      }
      await tx.product.update({ where: { id: productId }, data });
    }

    // Money and ledger.
    const entryDate = dateOnly(today);
    const L: Prisma.LedgerEntryCreateManyInput[] = [];
    const add = (account: string, debit: Paisa, credit: Paisa, party: string | null = null) => {
      if (debit || credit) L.push({ shopId, documentId: doc.id, account, debitPaisa: big(debit), creditPaisa: big(credit), partyId: party, entryDate });
    };
    for (const pay of payments) {
      await tx.payment.create({
        data: { shopId, partyId: partyId!, documentId: doc.id, direction: input.kind === 'SALE' ? 'RECEIVED' : 'PAID', amountPaisa: big(pay.amountPaisa), mode: pay.mode, paidOn: entryDate },
      });
      if (input.kind === 'SALE') add(moneyAccount(pay.mode), pay.amountPaisa, 0);
      else add(moneyAccount(pay.mode), 0, pay.amountPaisa);
    }
    if (input.kind === 'SALE') {
      add(ACC.SALES, 0, total);
      add(ACC.RECEIVABLE, total - paid, 0, partyId);
      add(ACC.COGS, result.cogsPaisa, 0);
      add(ACC.INVENTORY, 0, result.cogsPaisa);
      // FR-RCP-04: sequential receipt number per shop
      await tx.receipt.create({ data: { shopId, documentId: doc.id, receiptNo: formatNo('R', await nextNumber(tx, shopId, 'RECEIPT')) } });
    } else {
      add(ACC.INVENTORY, total, 0);
      add(ACC.PAYABLE, 0, total - paid, partyId);
    }
    if (L.length) await tx.ledgerEntry.createMany({ data: L });

    if (input.scanId) {
      const scan = await tx.scan.findFirst({ where: { id: input.scanId, shopId } });
      if (!scan) throw new NotFoundException('Scan not found');
      if (scan.status === 'CONFIRMED') throw new ConflictException('This scan is already confirmed');
      await tx.scan.update({ where: { id: scan.id }, data: { status: 'CONFIRMED', documentId: doc.id } });
    }
    await tx.auditLog.create({
      data: { shopId, userId: user.userId, action: `document.post.${input.kind.toLowerCase()}`, entity: 'document', entityId: doc.id, after: { docNo, totalPaisa: total, lines: prepared.length, scanId: input.scanId ?? null } },
    });
    return doc.id;
  }

  /**
   * FR-STK-05, BR-6: a posted document is never edited; the owner voids it.
   * The void is a new VOID document with equal and opposite movements, ledger entries and payments.
   */
  async void(user: AuthUser, id: string, reason: string): Promise<DocumentView> {
    if (!can(user.role, 'document.void')) throw new ForbiddenException('Only the owner can void a document');
    const voidId = await this.db.$transaction(
      async (tx) => {
        const shopId = user.shopId;
        const today = businessDate();
        assertDayOpen(today, await closedDates(tx, shopId, today));
        await tx.$queryRaw`SELECT id FROM "document" WHERE id = ${id}::uuid AND "shopId" = ${shopId}::uuid FOR UPDATE`;
        const doc = await tx.document.findFirst({ where: { id, shopId }, include: { lines: { include: { movement: true } }, payments: true, ledger: true, voidedBy: true } });
        if (!doc) throw new NotFoundException('Document not found');
        if (doc.kind === 'VOID') throw new BadRequestException('A void cannot be voided');
        if (doc.status === 'VOIDED' || doc.voidedBy) throw new ConflictException('Already voided');
        if (doc.status !== 'POSTED') throw new ConflictException('Documents with returns cannot be voided yet');

        const productIds = [...new Set(doc.lines.map((l) => l.productId))];
        await tx.$queryRaw`SELECT id FROM "product" WHERE id IN (${Prisma.join(productIds.map((p) => Prisma.sql`${p}::uuid`))}) FOR UPDATE`;
        const products = await tx.product.findMany({ where: { id: { in: productIds } } });
        const stock = new Map<string, StockState>(products.map((p) => [p.id, { onHandMilli: milli(p.onHand), valuePaisa: paisa(p.stockValuePaisa), lastUnitCostPaisa: paisa(p.lastUnitCostPaisa) }]));
        const original: Movement[] = doc.lines.map((l) => ({
          lineNo: l.lineNo,
          productId: l.productId,
          type: l.movement!.type,
          qtyMilli: milli(l.movement!.qtyBase),
          valuePaisa: paisa(l.movement!.valuePaisa),
          unitCostPaisa: paisa(l.movement!.unitCostPaisa),
          balanceAfterMilli: milli(l.movement!.balanceAfter),
        }));
        const settings = readSettings((await tx.shop.findUniqueOrThrow({ where: { id: shopId } })).settings);
        const reversed = reverseMovements(original, stock, { allowNegative: settings.allowNegativeStock });
        const rev = new Map(reversed.movements.map((m) => [m.lineNo, m]));

        const v = await tx.document.create({
          data: {
            shopId,
            kind: 'VOID',
            docNo: formatNo(DOC_PREFIX.VOID!, await nextNumber(tx, shopId, 'VOID')),
            docDate: dateOnly(today),
            partyId: doc.partyId,
            createdById: user.userId,
            payStatus: doc.payStatus,
            subtotalPaisa: doc.subtotalPaisa,
            discountPaisa: doc.discountPaisa,
            totalPaisa: doc.totalPaisa,
            paidPaisa: doc.paidPaisa,
            cogsPaisa: doc.cogsPaisa,
            reason,
            voidsDocId: doc.id,
            lines: {
              create: doc.lines.map((l) => {
                const m = rev.get(l.lineNo)!;
                return {
                  lineNo: l.lineNo,
                  productId: l.productId,
                  qty: l.qty,
                  unit: l.unit,
                  qtyBase: l.qtyBase,
                  ratePaisa: l.ratePaisa,
                  amountPaisa: l.amountPaisa,
                  movement: { create: { shopId, productId: l.productId, type: m.type, qtyBase: dec(m.qtyMilli), valuePaisa: big(m.valuePaisa), unitCostPaisa: big(m.unitCostPaisa), balanceAfter: dec(m.balanceAfterMilli) } },
                };
              }),
            },
          },
        });
        for (const [productId, s] of reversed.stock) {
          await tx.product.update({ where: { id: productId }, data: { onHand: dec(s.onHandMilli), stockValuePaisa: big(s.valuePaisa), lastUnitCostPaisa: big(s.lastUnitCostPaisa) } });
        }
        const entryDate = dateOnly(today);
        if (doc.ledger.length) {
          await tx.ledgerEntry.createMany({
            data: doc.ledger.map((e) => ({ shopId, documentId: v.id, account: e.account, debitPaisa: e.creditPaisa, creditPaisa: e.debitPaisa, partyId: e.partyId, entryDate })),
          });
        }
        for (const p of doc.payments) {
          await tx.payment.create({
            data: { shopId, partyId: p.partyId, documentId: v.id, direction: p.direction === 'RECEIVED' ? 'PAID' : 'RECEIVED', amountPaisa: p.amountPaisa, mode: p.mode, paidOn: entryDate, note: `Void of ${doc.docNo}` },
          });
        }
        await tx.document.update({ where: { id: doc.id }, data: { status: 'VOIDED' } });
        await tx.auditLog.create({ data: { shopId, userId: user.userId, action: 'document.void', entity: 'document', entityId: doc.id, reason, after: { voidDocId: v.id } } });
        return v.id;
      },
      { timeout: 30_000 },
    );
    return this.get(user.shopId, voidId);
  }
}
