import { Controller, ForbiddenException, Get, Query, Res } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { can } from '@erp/domain';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { businessDate, dateOnly, milli, paisa } from '../common/convert.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PartiesService } from '../parties/parties.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Cell = string | number | null;
interface Table {
  name: string;
  columns: { key: string; header: string; kind?: 'money' | 'qty' | 'text' }[];
  rows: Record<string, Cell>[];
}
interface Response {
  setHeader(k: string, v: string): void;
  end(b: Buffer | string): void;
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const format = z.enum(['json', 'csv', 'xlsx']).default('json');

/** Money columns are exported in rupees (2 decimals), quantities in base units (3 decimals). */
function cellValue(v: Cell, kind?: string): Cell {
  if (v == null) return null;
  if (kind === 'money') return Number(v) / 100;
  if (kind === 'qty') return Number(v) / 1000;
  return v;
}

function csv(t: Table): string {
  const esc = (v: Cell) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [t.columns.map((c) => esc(c.header)).join(',')];
  for (const r of t.rows) lines.push(t.columns.map((c) => esc(cellValue(r[c.key] ?? null, c.kind))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads Urdu/UTF-8 correctly
}

async function xlsx(t: Table): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Shop Inventory ERP';
  const ws = wb.addWorksheet(t.name.slice(0, 31));
  ws.columns = t.columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(10, c.header.length + 2), style: c.kind === 'money' ? { numFmt: '#,##0.00' } : c.kind === 'qty' ? { numFmt: '#,##0.###' } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of t.rows) ws.addRow(Object.fromEntries(t.columns.map((c) => [c.key, cellValue(r[c.key] ?? null, c.kind)])));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly db: PrismaService,
    private readonly parties: PartiesService,
  ) {}

  private async send(u: AuthUser, t: Table, fmt: 'json' | 'csv' | 'xlsx', res: Response, file: string) {
    if (fmt === 'json') {
      if (!can(u.role, 'report.view')) throw new ForbiddenException('Your role cannot view reports');
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ columns: t.columns, rows: t.rows }));
      return;
    }
    if (!can(u.role, 'report.export')) throw new ForbiddenException('Your role cannot export reports');
    await this.db.auditLog.create({ data: { shopId: u.shopId, userId: u.userId, action: 'report.export', entity: 'report', entityId: `${t.name}.${fmt}` } });
    if (fmt === 'csv') {
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="${file}.csv"`);
      res.end(csv(t));
    } else {
      res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('content-disposition', `attachment; filename="${file}.xlsx"`);
      res.end(await xlsx(t));
    }
  }

  /** FR-RPT-01/03: stock IN/OUT ledger, one row per line item, with the running balance. */
  @Get('stock-ledger')
  async stockLedger(
    @CurrentUser() u: AuthUser,
    @Query(new ZodPipe(z.object({ from: ymd.optional(), to: ymd.optional(), productId: z.string().uuid().optional(), partyId: z.string().uuid().optional(), kind: z.string().max(20).optional(), format })))
    q: { from?: string; to?: string; productId?: string; partyId?: string; kind?: string; format: 'json' | 'csv' | 'xlsx' },
    @Res() res: Response,
  ) {
    const from = dateOnly(q.from ?? '2000-01-01');
    const to = dateOnly(q.to ?? businessDate());
    const rows = await this.db.stockMovement.findMany({
      where: {
        shopId: u.shopId,
        productId: q.productId,
        docLine: { document: { docDate: { gte: from, lte: to }, ...(q.partyId ? { partyId: q.partyId } : {}), ...(q.kind ? { kind: q.kind as never } : {}) } },
      },
      include: { product: { select: { name: true, sku: true, baseUnit: true } }, docLine: { include: { document: { include: { party: { select: { name: true } } } } } } },
      orderBy: { at: 'asc' },
      take: 50_000,
    });
    const t: Table = {
      name: 'Stock ledger',
      columns: [
        { key: 'date', header: 'Date' },
        { key: 'type', header: 'Type' },
        { key: 'docNo', header: 'Doc no' },
        { key: 'party', header: 'Party' },
        { key: 'sku', header: 'SKU' },
        { key: 'product', header: 'Product' },
        { key: 'qty', header: 'Qty', kind: 'qty' },
        { key: 'unit', header: 'Unit' },
        { key: 'rate', header: 'Rate', kind: 'money' },
        { key: 'amount', header: 'Amount', kind: 'money' },
        { key: 'moved', header: 'Stock change (base unit)', kind: 'qty' },
        { key: 'balance', header: 'Running balance', kind: 'qty' },
        { key: 'unitCost', header: 'Unit cost', kind: 'money' },
      ],
      rows: rows.map((m) => {
        const d = m.docLine.document;
        return {
          date: d.docDate.toISOString().slice(0, 10),
          type: d.kind,
          docNo: d.docNo,
          party: d.party?.name ?? null,
          sku: m.product.sku,
          product: m.product.name,
          qty: milli(m.docLine.qty) * (m.type === 'OUT' ? -1 : 1),
          unit: m.docLine.unit,
          rate: paisa(m.docLine.ratePaisa),
          amount: paisa(m.docLine.amountPaisa),
          moved: milli(m.qtyBase),
          balance: milli(m.balanceAfter),
          unitCost: paisa(m.unitCostPaisa),
        };
      }),
    };
    await this.send(u, t, q.format, res, `stock-ledger-${q.from ?? 'all'}-${q.to ?? businessDate()}`);
  }

  /** FR-RPT-04: quantity × average cost at the end of any date, from the movements up to that day. */
  @Get('stock-valuation')
  async valuation(@CurrentUser() u: AuthUser, @Query(new ZodPipe(z.object({ date: ymd.optional(), format }))) q: { date?: string; format: 'json' | 'csv' | 'xlsx' }, @Res() res: Response) {
    const at = q.date ?? businessDate();
    const rows = await this.db.$queryRaw<{ sku: string; name: string; unit: string; qty: string; value: bigint }[]>`
      SELECT p.sku, p.name, p."baseUnit" AS unit, coalesce(sum(m."qtyBase"), 0)::text AS qty, coalesce(sum(m."valuePaisa"), 0)::bigint AS value
      FROM "product" p
      LEFT JOIN "stock_movement" m ON m."productId" = p.id
        AND EXISTS (SELECT 1 FROM "doc_line" l JOIN "document" d ON d.id = l."documentId" WHERE l.id = m."docLineId" AND d."docDate" <= ${dateOnly(at)})
      WHERE p."shopId" = ${u.shopId}::uuid
      GROUP BY p.id ORDER BY p.name`;
    const t: Table = {
      name: `Stock value ${at}`,
      columns: [
        { key: 'sku', header: 'SKU' },
        { key: 'name', header: 'Product' },
        { key: 'unit', header: 'Unit' },
        { key: 'qty', header: 'Qty', kind: 'qty' },
        { key: 'avgCost', header: 'Avg cost', kind: 'money' },
        { key: 'value', header: 'Value', kind: 'money' },
      ],
      rows: rows.map((r) => {
        const qty = milli(r.qty);
        const value = paisa(r.value);
        return { sku: r.sku, name: r.name, unit: r.unit, qty, avgCost: qty > 0 ? Math.round((value * 1000) / qty) : null, value };
      }),
    };
    t.rows.push({ sku: null, name: 'TOTAL', unit: null, qty: null, avgCost: null, value: t.rows.reduce((s, r) => s + Number(r.value ?? 0), 0) });
    await this.send(u, t, q.format, res, `stock-valuation-${at}`);
  }

  /** FR-RPT-05: supplier payables and customer receivables. */
  @Get('party-balances')
  async partyBalances(@CurrentUser() u: AuthUser, @Query(new ZodPipe(z.object({ format }))) q: { format: 'json' | 'csv' | 'xlsx' }, @Res() res: Response) {
    const parties = await this.db.party.findMany({ where: { shopId: u.shopId, active: true }, orderBy: { name: 'asc' } });
    const bal = await this.parties.balances(u.shopId, parties.map((p) => p.id));
    const t: Table = {
      name: 'Party balances',
      columns: [
        { key: 'name', header: 'Party' },
        { key: 'type', header: 'Type' },
        { key: 'phone', header: 'Phone' },
        { key: 'receivable', header: 'They owe us', kind: 'money' },
        { key: 'payable', header: 'We owe them', kind: 'money' },
      ],
      rows: parties.map((p) => {
        const b = bal.get(p.id) ?? 0;
        return { name: p.name, type: p.type, phone: p.phone, receivable: b > 0 ? b : 0, payable: b < 0 ? -b : 0 };
      }),
    };
    await this.send(u, t, q.format, res, `party-balances-${businessDate()}`);
  }
}
