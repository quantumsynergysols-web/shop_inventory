import { Controller, Get } from '@nestjs/common';
import { can } from '@erp/domain';
import { CurrentUser, Requires, type AuthUser } from '../auth/decorators.js';
import { businessDate, dateOnly, milli, paisa } from '../common/convert.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** FR-DSH-01..03, FR-DSH-05. Money figures that reveal profit or stock value only for roles allowed to see them. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly db: PrismaService) {}

  @Requires('dashboard.view')
  @Get()
  async get(@CurrentUser() u: AuthUser) {
    const today = dateOnly(businessDate());
    const shopId = u.shopId;
    const [products, stock, todayDocs, pending, recentScans, recentDocs, closing] = await Promise.all([
      this.db.product.count({ where: { shopId, active: true } }),
      this.db.$queryRaw<{ value: bigint | null }[]>`SELECT sum("stockValuePaisa")::bigint AS value FROM "product" WHERE "shopId" = ${shopId}::uuid AND active`,
      this.db.document.findMany({ where: { shopId, docDate: today, kind: { in: ['SALE', 'PURCHASE'] }, status: { not: 'VOIDED' } }, select: { kind: true, totalPaisa: true, cogsPaisa: true } }),
      this.db.scan.count({ where: { shopId, status: { in: ['NEEDS_REVIEW', 'FAILED'] } } }),
      this.db.scan.findMany({ where: { shopId }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, type: true, status: true, createdAt: true, pageCount: true, documentId: true } }),
      this.db.document.findMany({ where: { shopId }, orderBy: { postedAt: 'desc' }, take: 8, include: { party: { select: { name: true } }, _count: { select: { lines: true } } } }),
      this.db.dayClosing.findFirst({ where: { shopId, businessDate: today } }),
    ]);
    // BR-4: low stock when on hand ≤ min level
    const low = await this.db.$queryRaw<{ id: string; name: string; on_hand: string; min_level: string }[]>`
      SELECT id, name, "onHand"::text AS on_hand, "minLevel"::text AS min_level FROM "product"
      WHERE "shopId" = ${shopId}::uuid AND active AND "onHand" <= "minLevel" ORDER BY ("onHand" - "minLevel") ASC, name LIMIT 50`;
    const sum = (kind: string, f: 'totalPaisa' | 'cogsPaisa') => todayDocs.filter((d) => d.kind === kind).reduce((s, d) => s + paisa(d[f]), 0);
    const salesToday = sum('SALE', 'totalPaisa');
    const financials = can(u.role, 'dashboard.view_financials');
    return {
      date: businessDate(),
      dayStatus: closing?.status ?? 'OPEN',
      totalProducts: products,
      stockValuePaisa: financials ? paisa(stock[0]?.value ?? 0n) : null,
      purchasesTodayPaisa: sum('PURCHASE', 'totalPaisa'),
      salesTodayPaisa: salesToday,
      salesTodayCount: todayDocs.filter((d) => d.kind === 'SALE').length,
      grossProfitTodayPaisa: financials ? salesToday - sum('SALE', 'cogsPaisa') : null,
      lowStockCount: low.length,
      lowStock: low.slice(0, 10).map((r) => ({ id: r.id, name: r.name, onHandMilli: milli(r.on_hand), minLevelMilli: milli(r.min_level) })),
      pendingReviews: pending,
      recentScans,
      recentDocuments: recentDocs.map((d) => ({ id: d.id, kind: d.kind, docNo: d.docNo, party: d.party?.name ?? null, totalPaisa: paisa(d.totalPaisa), lines: d._count.lines, status: d.status, postedAt: d.postedAt })),
    };
  }
}
