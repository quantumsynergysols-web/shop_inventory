import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PayMode } from '@prisma/client';
import {
  assertDayOpen,
  can,
  canAddExpense,
  canCloseDay,
  closeDay,
  summarizeDay,
  type DayInput,
  type DaySummary,
  type MoneyEntry,
  type Paisa,
  type SaleBill,
  type SalesReturnEntry,
} from '@erp/domain';
import type { AuthUser } from '../auth/decorators.js';
import { big, businessDate, dateOnly, milli, paisa } from '../common/convert.js';
import { readSettings } from '../common/shop-settings.js';
import { ACC, closedDates, moneyAccount } from '../parties/parties.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const entry = (p: { mode: PayMode; amountPaisa: bigint }, sign = 1): MoneyEntry => ({ mode: p.mode, amountPaisa: sign * paisa(p.amountPaisa) });

@Injectable()
export class DayService {
  constructor(private readonly db: PrismaService) {}

  /**
   * Gathers one business day from the database for summarizeDay (SRS §3.10a, BR-8, BR-9).
   * A sale voided on the same day is left out together with its void. A sale from an earlier
   * day voided today counts as today's sales return (its cash refund leaves the galla today).
   */
  async input(shopId: string, ymd: string): Promise<DayInput> {
    const day = dateOnly(ymd);
    const [docs, voids, standalone, expenses, prev] = await Promise.all([
      this.db.document.findMany({ where: { shopId, docDate: day, kind: { in: ['SALE', 'PURCHASE'] } }, include: { payments: true, voidedBy: { select: { docDate: true } } } }),
      this.db.document.findMany({ where: { shopId, docDate: day, kind: 'VOID' }, include: { payments: true, voidsDoc: true } }),
      this.db.payment.findMany({ where: { shopId, paidOn: day, documentId: null } }),
      this.db.expense.findMany({ where: { shopId, businessDate: day } }),
      this.db.dayClosing.findFirst({ where: { shopId, businessDate: { lt: day }, countedCashPaisa: { not: null } }, orderBy: { businessDate: 'desc' } }),
    ]);
    const voidedSameDay = (d: (typeof docs)[number]) => !!d.voidedBy && d.voidedBy.docDate.getTime() === day.getTime();

    const sales: SaleBill[] = docs
      .filter((d) => d.kind === 'SALE' && !voidedSameDay(d))
      .map((d) => ({ totalPaisa: paisa(d.totalPaisa), paid: d.payments.map((p) => entry(p)), cogsPaisa: paisa(d.cogsPaisa) }));
    const salesReturns: SalesReturnEntry[] = [];
    const supplierPayments: MoneyEntry[] = [];
    for (const d of docs.filter((x) => x.kind === 'PURCHASE' && !voidedSameDay(x))) supplierPayments.push(...d.payments.map((p) => entry(p)));
    for (const v of voids) {
      const o = v.voidsDoc;
      if (!o || o.docDate.getTime() === day.getTime()) continue; // same-day void: both left out above
      if (o.kind === 'SALE') {
        salesReturns.push({ totalPaisa: paisa(o.totalPaisa), refunds: v.payments.map((p) => entry(p)), cogsReversedPaisa: paisa(o.cogsPaisa) });
      } else if (o.kind === 'PURCHASE') {
        supplierPayments.push(...v.payments.map((p) => entry(p, -1))); // money came back from the supplier
      }
    }
    for (const p of standalone) if (p.direction === 'PAID') supplierPayments.push(entry(p));
    return {
      openingCashPaisa: prev?.countedCashPaisa == null ? 0 : paisa(prev.countedCashPaisa),
      sales,
      salesReturns,
      expenses: expenses.map((e) => ({ mode: e.paidFrom, amountPaisa: paisa(e.amountPaisa) })),
      customerPayments: standalone.filter((p) => p.direction === 'RECEIVED').map((p) => entry(p)),
      supplierPayments,
      purchasesPaisa: docs.filter((d) => d.kind === 'PURCHASE' && !voidedSameDay(d)).reduce((s, d) => s + paisa(d.totalPaisa), 0),
    };
  }

  async summary(shopId: string, ymd: string): Promise<DaySummary> {
    return summarizeDay(await this.input(shopId, ymd));
  }

  /** FR-CLS-01..03: the "Aaj ka hisaab" screen. */
  async get(user: AuthUser, ymd = businessDate()) {
    if (!can(user.role, 'day.view')) throw new ForbiddenException('Your role cannot view the day closing');
    const day = dateOnly(ymd);
    const [summary, closing, expenses, pendingScans, shop] = await Promise.all([
      this.summary(user.shopId, ymd),
      this.db.dayClosing.findFirst({ where: { shopId: user.shopId, businessDate: day }, include: { closedBy: { select: { name: true } } } }),
      this.db.expense.findMany({ where: { shopId: user.shopId, businessDate: day }, include: { head: true, user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }),
      this.pendingScans(user.shopId, ymd),
      this.db.shop.findUniqueOrThrow({ where: { id: user.shopId } }),
    ]);
    const settings = readSettings(shop.settings);
    return {
      date: ymd,
      status: closing?.status ?? 'OPEN',
      summary,
      expenses: expenses.map((e) => ({ id: e.id, head: e.head.name, amountPaisa: paisa(e.amountPaisa), paidFrom: e.paidFrom, note: e.note, by: e.user.name, at: e.createdAt })),
      closing: closing?.countedCashPaisa != null
        ? { countedCashPaisa: paisa(closing.countedCashPaisa), differencePaisa: paisa(closing.differencePaisa), note: closing.note, closedBy: closing.closedBy?.name ?? null, closedAt: closing.closedAt, reopenReason: closing.reopenReason }
        : null,
      pendingScans,
      noteLimitPaisa: settings.closingNoteLimitPaisa,
      canClose: canCloseDay(user.role, settings),
    };
  }

  private pendingScans(shopId: string, ymd: string) {
    const start = new Date(`${ymd}T00:00:00+05:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60_000);
    return this.db.scan.count({ where: { shopId, status: { in: ['PROCESSING', 'NEEDS_REVIEW'] }, createdAt: { gte: start, lt: end } } });
  }

  /** FR-EXP-01/02 */
  async addExpense(user: AuthUser, input: { headId: string; amountPaisa: Paisa; paidFrom: PayMode; note?: string | null }) {
    const shop = await this.db.shop.findUniqueOrThrow({ where: { id: user.shopId } });
    const settings = readSettings(shop.settings);
    if (!canAddExpense(user.role, { amountPaisa: input.amountPaisa, paidFrom: input.paidFrom }, settings)) {
      throw new ForbiddenException(user.role === 'SALESMAN' ? `Salesman can add only cash expenses up to Rs ${settings.salesmanExpenseLimitPaisa / 100}` : 'Your role cannot add expenses');
    }
    const head = await this.db.expenseHead.findFirst({ where: { id: input.headId, shopId: user.shopId, active: true } });
    if (!head) throw new NotFoundException('Expense head not found');
    const today = businessDate();
    return this.db.$transaction(async (tx) => {
      assertDayOpen(today, await closedDates(tx, user.shopId, today));
      const e = await tx.expense.create({
        data: { shopId: user.shopId, businessDate: dateOnly(today), headId: head.id, amountPaisa: big(input.amountPaisa), paidFrom: input.paidFrom, note: input.note ?? null, userId: user.userId },
      });
      await tx.ledgerEntry.createMany({
        data: [
          { shopId: user.shopId, account: ACC.EXPENSE, debitPaisa: big(input.amountPaisa), creditPaisa: 0n, entryDate: dateOnly(today) },
          { shopId: user.shopId, account: moneyAccount(input.paidFrom), debitPaisa: 0n, creditPaisa: big(input.amountPaisa), entryDate: dateOnly(today) },
        ],
      });
      await tx.auditLog.create({ data: { shopId: user.shopId, userId: user.userId, action: 'expense.create', entity: 'expense', entityId: e.id, after: { head: head.name, amountPaisa: input.amountPaisa, paidFrom: input.paidFrom } } });
      return { id: e.id, head: head.name, amountPaisa: input.amountPaisa, paidFrom: e.paidFrom, note: e.note, businessDate: today };
    });
  }

  async heads(shopId: string) {
    return this.db.expenseHead.findMany({ where: { shopId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  }

  async addHead(user: AuthUser, name: string) {
    if (!can(user.role, 'settings.manage')) throw new ForbiddenException('Only the owner can edit expense heads');
    return this.db.expenseHead.create({ data: { shopId: user.shopId, name: name.trim() }, select: { id: true, name: true } });
  }

  /**
   * FR-CLS-04..06 ("Din band karein"). Saves every total, the counted cash and the difference;
   * the counted cash becomes the next day's opening cash. Unconfirmed scans of the day block
   * closing unless `force` is set (UC-13 alternate 6a).
   */
  async close(user: AuthUser, input: { countedCashPaisa: Paisa; note?: string | null; date?: string; force?: boolean }) {
    const shop = await this.db.shop.findUniqueOrThrow({ where: { id: user.shopId } });
    const settings = readSettings(shop.settings);
    if (!canCloseDay(user.role, settings)) throw new ForbiddenException('Only the owner can close the day (or a salesman when the owner allows it)');
    const today = businessDate();
    const ymd = input.date ?? today;
    const day = dateOnly(ymd);
    const existing = await this.db.dayClosing.findFirst({ where: { shopId: user.shopId, businessDate: day } });
    if (existing?.status === 'CLOSED') throw new ConflictException('This day is already closed');
    if (ymd !== today && (existing?.status !== 'REOPENED' || user.role !== 'OWNER')) throw new ForbiddenException('Only a reopened past day can be closed again, by the owner');
    const pending = await this.pendingScans(user.shopId, ymd);
    if (pending && !input.force) throw new ConflictException({ code: 'PENDING_SCANS', message: `${pending} scan(s) of this day are not confirmed. Confirm or discard them first.`, pending });

    const summary = await this.summary(user.shopId, ymd);
    const result = closeDay(summary, input.countedCashPaisa, { note: input.note ?? undefined, noteLimitPaisa: settings.closingNoteLimitPaisa });
    const totals = {
      status: 'CLOSED' as const,
      openingCashPaisa: big(summary.openingCashPaisa),
      billCount: summary.billCount,
      salesTotalPaisa: big(summary.saleTotalPaisa),
      salesCashPaisa: big(summary.salesCashPaisa),
      salesBankPaisa: big(summary.salesBankPaisa),
      salesCreditPaisa: big(summary.salesCreditPaisa),
      cogsPaisa: big(summary.cogsPaisa),
      grossProfitPaisa: big(summary.grossProfitPaisa),
      expensesTotalPaisa: big(summary.expensesTotalPaisa),
      netProfitPaisa: big(summary.netProfitPaisa),
      purchasesTotalPaisa: big(summary.purchasesPaisa),
      wasooliCashPaisa: big(summary.wasooliCashPaisa),
      wasooliBankPaisa: big(summary.wasooliBankPaisa),
      supplierPaidCashPaisa: big(summary.supplierPaidCashPaisa),
      supplierPaidBankPaisa: big(summary.supplierPaidBankPaisa),
      cashRefundsPaisa: big(summary.cashRefundsPaisa),
      expectedCashPaisa: big(result.expectedCashPaisa),
      countedCashPaisa: big(result.countedCashPaisa),
      differencePaisa: big(result.differencePaisa),
      note: result.note,
      closedById: user.userId,
      closedAt: new Date(),
    };
    const closing = await this.db.$transaction(async (tx) => {
      const c = existing
        ? await tx.dayClosing.update({ where: { id: existing.id }, data: totals })
        : await tx.dayClosing.create({ data: { shopId: user.shopId, businessDate: day, ...totals } });
      await tx.expense.updateMany({ where: { shopId: user.shopId, businessDate: day }, data: { dayClosingId: c.id } });
      await tx.auditLog.create({
        data: { shopId: user.shopId, userId: user.userId, action: existing ? 'day.reclose' : 'day.close', entity: 'day_closing', entityId: c.id, reason: result.note, after: { date: ymd, countedCashPaisa: result.countedCashPaisa, differencePaisa: result.differencePaisa } },
      });
      return c;
    });
    return { date: ymd, summary, ...result, status: closing.status };
  }

  /** FR-CLS-05: only the owner reopens a closed day, with a reason; written to the audit log. */
  async reopen(user: AuthUser, ymd: string, reason: string) {
    if (!can(user.role, 'day.reopen')) throw new ForbiddenException('Only the owner can reopen a day');
    const c = await this.db.dayClosing.findFirst({ where: { shopId: user.shopId, businessDate: dateOnly(ymd) } });
    if (!c || c.status !== 'CLOSED') throw new ConflictException('This day is not closed');
    await this.db.dayClosing.update({ where: { id: c.id }, data: { status: 'REOPENED', reopenReason: reason } });
    await this.db.auditLog.create({ data: { shopId: user.shopId, userId: user.userId, action: 'day.reopen', entity: 'day_closing', entityId: c.id, reason } });
    return { date: ymd, status: 'REOPENED' };
  }

  /** FR-CLS-09/10: month totals, expenses by head, best-selling and most profitable items. */
  async month(user: AuthUser, ym: string) {
    if (!can(user.role, 'report.view')) throw new ForbiddenException('Your role cannot view monthly profit');
    const from = dateOnly(`${ym}-01`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const shopId = user.shopId;
    const [sales, expenses, items, closings] = await Promise.all([
      this.db.document.aggregate({ where: { shopId, kind: 'SALE', status: { not: 'VOIDED' }, docDate: { gte: from, lt: to } }, _sum: { totalPaisa: true, cogsPaisa: true }, _count: true }),
      this.db.$queryRaw<{ head: string; total: bigint }[]>`
        SELECT h.name AS head, sum(e."amountPaisa")::bigint AS total FROM "expense" e JOIN "expense_head" h ON h.id = e."headId"
        WHERE e."shopId" = ${shopId}::uuid AND e."businessDate" >= ${from} AND e."businessDate" < ${to} GROUP BY h.name ORDER BY total DESC`,
      this.db.$queryRaw<{ id: string; name: string; qty: string; revenue: bigint; cogs: bigint }[]>`
        SELECT p.id, p.name, sum(l."qtyBase")::text AS qty, sum(l."amountPaisa")::bigint AS revenue, sum(-m."valuePaisa")::bigint AS cogs
        FROM "doc_line" l JOIN "document" d ON d.id = l."documentId" JOIN "stock_movement" m ON m."docLineId" = l.id JOIN "product" p ON p.id = l."productId"
        WHERE d."shopId" = ${shopId}::uuid AND d.kind = 'SALE' AND d.status <> 'VOIDED' AND d."docDate" >= ${from} AND d."docDate" < ${to}
        GROUP BY p.id, p.name`,
      this.db.dayClosing.findMany({ where: { shopId, businessDate: { gte: from, lt: to } }, orderBy: { businessDate: 'asc' } }),
    ]);
    const sale = paisa(sales._sum.totalPaisa);
    const cogs = paisa(sales._sum.cogsPaisa);
    const expByHead = expenses.map((e) => ({ head: e.head, totalPaisa: paisa(e.total) }));
    const expTotal = expByHead.reduce((s, e) => s + e.totalPaisa, 0);
    const itemRows = items.map((i) => ({ productId: i.id, name: i.name, qtyMilli: milli(i.qty), revenuePaisa: paisa(i.revenue), cogsPaisa: paisa(i.cogs), profitPaisa: paisa(i.revenue) - paisa(i.cogs) }));
    return {
      month: ym,
      bills: sales._count,
      salePaisa: sale,
      cogsPaisa: cogs,
      grossProfitPaisa: sale - cogs,
      marginPct: sale > 0 ? Math.round(((sale - cogs) * 1000) / sale) / 10 : 0,
      expensesByHead: expByHead,
      expensesTotalPaisa: expTotal,
      netProfitPaisa: sale - cogs - expTotal,
      bestSelling: [...itemRows].sort((a, b) => b.qtyMilli - a.qtyMilli).slice(0, 10),
      mostProfitable: [...itemRows].sort((a, b) => b.profitPaisa - a.profitPaisa).slice(0, 10),
      days: closings.map((c) => ({ date: c.businessDate.toISOString().slice(0, 10), status: c.status, salePaisa: paisa(c.salesTotalPaisa), netProfitPaisa: paisa(c.netProfitPaisa), differencePaisa: c.differencePaisa == null ? null : paisa(c.differencePaisa) })),
    };
  }
}
