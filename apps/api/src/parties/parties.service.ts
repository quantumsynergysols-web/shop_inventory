import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PartyType, type PayMode } from '@prisma/client';
import { assertDayOpen, can, normalizeName, type Paisa } from '@erp/domain';
import type { AuthUser } from '../auth/decorators.js';
import { big, businessDate, dateOnly, paisa } from '../common/convert.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Ledger accounts used across the API.
 * RECEIVABLE: debit = customer owes the shop more. PAYABLE: credit = shop owes the supplier more.
 */
export const ACC = {
  CASH: 'CASH',
  BANK: 'BANK',
  RECEIVABLE: 'RECEIVABLE',
  PAYABLE: 'PAYABLE',
  SALES: 'SALES',
  PURCHASES: 'PURCHASES',
  INVENTORY: 'INVENTORY',
  COGS: 'COGS',
  EXPENSE: 'EXPENSE',
} as const;

export const moneyAccount = (mode: PayMode) => (mode === 'CASH' ? ACC.CASH : ACC.BANK);

export interface PartyView {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  type: PartyType;
  priceLevel: string;
  openingBalancePaisa: Paisa;
  /** Positive: the party owes the shop. Negative: the shop owes the party (BR-7). */
  balancePaisa: Paisa;
  active: boolean;
}

export async function closedDates(db: Prisma.TransactionClient | PrismaService, shopId: string, ymd: string): Promise<Set<string>> {
  const closed = await db.dayClosing.findFirst({ where: { shopId, businessDate: dateOnly(ymd), status: 'CLOSED' } });
  return closed ? new Set([ymd]) : new Set();
}

@Injectable()
export class PartiesService {
  constructor(private readonly db: PrismaService) {}

  private visibleTypes(user: AuthUser): PartyType[] {
    const c = can(user.role, 'party.view_customers');
    const s = can(user.role, 'party.view_suppliers');
    if (c && s) return ['CUSTOMER', 'SUPPLIER', 'BOTH'];
    if (c) return ['CUSTOMER', 'BOTH'];
    if (s) return ['SUPPLIER', 'BOTH'];
    return [];
  }

  async balances(shopId: string, partyIds: string[]): Promise<Map<string, Paisa>> {
    if (partyIds.length === 0) return new Map();
    const rows = await this.db.$queryRaw<{ partyId: string; bal: bigint }[]>`
      SELECT "partyId", sum(CASE WHEN account = 'RECEIVABLE' THEN "debitPaisa" - "creditPaisa"
                                 WHEN account = 'PAYABLE' THEN "debitPaisa" - "creditPaisa" ELSE 0 END)::bigint AS bal
      FROM "ledger_entry" WHERE "shopId" = ${shopId}::uuid AND "partyId" IN (${Prisma.join(partyIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY "partyId"`;
    return new Map(rows.map((r) => [r.partyId, paisa(r.bal)]));
  }

  async list(user: AuthUser, f: { q?: string; type?: PartyType }): Promise<PartyView[]> {
    const types = this.visibleTypes(user).filter((t) => !f.type || t === f.type || t === 'BOTH');
    const q = f.q ? normalizeName(f.q) : '';
    let ids: string[] | undefined;
    if (q) {
      const hits = await this.db.$queryRaw<{ id: string }[]>`
        SELECT id FROM "party" WHERE "shopId" = ${user.shopId}::uuid
          AND ("normalizedName" LIKE ${'%' + q + '%'} OR similarity("normalizedName", ${q}) > 0.25 OR phone LIKE ${'%' + f.q!.replace(/\D/g, '') + '%'})
        ORDER BY similarity("normalizedName", ${q}) DESC LIMIT 50`;
      ids = hits.map((h) => h.id);
    }
    const rows = await this.db.party.findMany({
      where: { shopId: user.shopId, active: true, type: { in: types }, ...(ids ? { id: { in: ids } } : {}) },
      orderBy: { name: 'asc' },
      take: 200,
    });
    const bal = await this.balances(user.shopId, rows.map((r) => r.id));
    const views = rows.map((p) => this.view(p, bal.get(p.id) ?? 0));
    if (ids) {
      const order = new Map(ids.map((id, i) => [id, i]));
      views.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    return views;
  }

  async get(user: AuthUser, id: string): Promise<PartyView & { history: unknown[] }> {
    const p = await this.db.party.findFirst({ where: { id, shopId: user.shopId } });
    if (!p || !this.visibleTypes(user).includes(p.type)) throw new NotFoundException('Party not found');
    const bal = await this.balances(user.shopId, [id]);
    // FR-PTY-02: all documents and payments of the party
    const [docs, pays] = await Promise.all([
      this.db.document.findMany({ where: { shopId: user.shopId, partyId: id }, orderBy: { postedAt: 'desc' }, take: 200 }),
      this.db.payment.findMany({ where: { shopId: user.shopId, partyId: id, documentId: null }, orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);
    const history = [
      ...docs.map((d) => ({ kind: 'document', id: d.id, type: d.kind, no: d.docNo, date: d.docDate, totalPaisa: paisa(d.totalPaisa), paidPaisa: paisa(d.paidPaisa), status: d.status, at: d.postedAt })),
      ...pays.map((x) => ({ kind: 'payment', id: x.id, type: x.direction, mode: x.mode, date: x.paidOn, amountPaisa: paisa(x.amountPaisa), note: x.note, at: x.createdAt })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    return { ...this.view(p, bal.get(id) ?? 0), history };
  }

  async create(user: AuthUser, input: { name: string; phone?: string | null; address?: string | null; type: PartyType; openingBalancePaisa?: Paisa }): Promise<PartyView> {
    if (!this.visibleTypes(user).includes(input.type)) throw new ForbiddenException(`Your role cannot add a ${input.type.toLowerCase()}`);
    const name = input.name.trim();
    const opening = input.openingBalancePaisa ?? 0;
    const p = await this.db.$transaction(async (tx) => {
      const party = await tx.party.create({
        data: { shopId: user.shopId, name, normalizedName: normalizeName(name), phone: input.phone ?? null, address: input.address ?? null, type: input.type, openingBalancePaisa: big(opening) },
      });
      if (opening !== 0) {
        const account = opening > 0 ? ACC.RECEIVABLE : ACC.PAYABLE;
        await tx.ledgerEntry.create({
          data: { shopId: user.shopId, partyId: party.id, account, debitPaisa: big(Math.max(opening, 0)), creditPaisa: big(Math.max(-opening, 0)), entryDate: dateOnly(businessDate()) },
        });
      }
      await tx.auditLog.create({ data: { shopId: user.shopId, userId: user.userId, action: 'party.create', entity: 'party', entityId: party.id, after: { name, type: input.type } } });
      return party;
    });
    return this.view(p, opening);
  }

  /**
   * FR-PTY-03: payment received from a customer (wasooli) or paid to a supplier.
   * Ledger: RECEIVED → debit CASH/BANK, credit RECEIVABLE. PAID → debit PAYABLE, credit CASH/BANK.
   */
  async recordPayment(user: AuthUser, partyId: string, input: { direction: 'RECEIVED' | 'PAID'; amountPaisa: Paisa; mode: PayMode; note?: string | null }) {
    const action = input.direction === 'RECEIVED' ? 'payment.customer_receipt' : 'payment.supplier';
    if (!can(user.role, action)) throw new ForbiddenException(`Your role (${user.role}) cannot do ${action}`);
    const party = await this.db.party.findFirst({ where: { id: partyId, shopId: user.shopId } });
    if (!party) throw new NotFoundException('Party not found');
    const today = businessDate();
    return this.db.$transaction(async (tx) => {
      assertDayOpen(today, await closedDates(tx, user.shopId, today));
      const pay = await tx.payment.create({
        data: { shopId: user.shopId, partyId, direction: input.direction, amountPaisa: big(input.amountPaisa), mode: input.mode, paidOn: dateOnly(today), note: input.note ?? null },
      });
      const amt = big(input.amountPaisa);
      const entries =
        input.direction === 'RECEIVED'
          ? [
              { account: moneyAccount(input.mode), debitPaisa: amt, creditPaisa: 0n, partyId: null },
              { account: ACC.RECEIVABLE, debitPaisa: 0n, creditPaisa: amt, partyId },
            ]
          : [
              { account: ACC.PAYABLE, debitPaisa: amt, creditPaisa: 0n, partyId },
              { account: moneyAccount(input.mode), debitPaisa: 0n, creditPaisa: amt, partyId: null },
            ];
      await tx.ledgerEntry.createMany({ data: entries.map((e) => ({ ...e, shopId: user.shopId, paymentId: pay.id, entryDate: dateOnly(today) })) });
      await tx.auditLog.create({ data: { shopId: user.shopId, userId: user.userId, action: `payment.${input.direction.toLowerCase()}`, entity: 'payment', entityId: pay.id, after: { partyId, amountPaisa: input.amountPaisa, mode: input.mode } } });
      return { id: pay.id, direction: pay.direction, amountPaisa: input.amountPaisa, mode: pay.mode, paidOn: today };
    });
  }

  private view(p: { id: string; name: string; phone: string | null; address: string | null; type: PartyType; priceLevel: string; openingBalancePaisa: bigint; active: boolean }, balance: Paisa): PartyView {
    return { id: p.id, name: p.name, phone: p.phone, address: p.address, type: p.type, priceLevel: p.priceLevel, openingBalancePaisa: paisa(p.openingBalancePaisa), balancePaisa: balance, active: p.active };
  }
}
