import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { AuthUser } from '../auth/decorators.js';
import { businessDate } from '../common/convert.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FILE_STORAGE, type FileStorage } from '../storage/storage.js';

type Row = Record<string, unknown>;

/** Excel-friendly values: whole paisa and thousandths stay exact as numbers or text, JSON as text. */
function cell(v: unknown): ExcelJS.CellValue {
  if (v == null) return null;
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (v instanceof Prisma.Decimal) return v.toString().length > 15 ? v.toString() : v.toNumber();
  if (v instanceof Date) return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return v as ExcelJS.CellValue;
}

function addSheet(wb: ExcelJS.Workbook, name: string, rows: Row[], omit: string[] = []) {
  const ws = wb.addWorksheet(name);
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !omit.includes(k));
  ws.columns = keys.map((k) => ({ header: k, key: k, width: Math.min(40, Math.max(10, k.length + 2)) }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(Object.fromEntries(keys.map((k) => [k, cell(r[k])])));
}

const README = `Shop Inventory ERP – full export (SRS FR-SET-05)

shop-data.xlsx has one sheet per table of your shop.
- Columns ending in "Paisa" are money in paisa: divide by 100 for rupees (12500 = Rs 125).
- Quantities (qty, qtyBase, onHand, minLevel, balanceAfter) are in the product's unit, up to 3 decimals.
- Ids link the sheets: a document line's documentId is the id of its document, and so on.
- Passwords are never exported.

photos/ has every bill photo, one folder per scan, named by scan date and id.
`;

/**
 * FR-SET-05: everything one shop owns, as Excel plus its bill photos, in one zip.
 * Runs inside the request's shop context, so row-level security also limits it to this shop.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly db: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async build(user: AuthUser): Promise<{ filename: string; zip: JSZip; photos: number; missing: number }> {
    const shopId = user.shopId;
    const where = { shopId };
    const [shop, users, categories, products, units, aliases, prices, parties, documents, lines, movements, receipts, payments, ledger, closings, heads, expenses, scans, scanLines, audit] =
      await Promise.all([
        this.db.shop.findMany({ where: { id: shopId } }),
        this.db.user.findMany({ where }),
        this.db.category.findMany({ where }),
        this.db.product.findMany({ where, orderBy: { sku: 'asc' } }),
        this.db.productUnit.findMany({ where: { product: where } }),
        this.db.productAlias.findMany({ where: { product: where } }),
        this.db.priceHistory.findMany({ where: { product: where }, orderBy: { at: 'asc' } }),
        this.db.party.findMany({ where, orderBy: { name: 'asc' } }),
        this.db.document.findMany({ where, orderBy: { postedAt: 'asc' } }),
        this.db.docLine.findMany({ where: { document: where }, orderBy: [{ documentId: 'asc' }, { lineNo: 'asc' }] }),
        this.db.stockMovement.findMany({ where, orderBy: { at: 'asc' } }),
        this.db.receipt.findMany({ where }),
        this.db.payment.findMany({ where, orderBy: { createdAt: 'asc' } }),
        this.db.ledgerEntry.findMany({ where, orderBy: { createdAt: 'asc' } }),
        this.db.dayClosing.findMany({ where, orderBy: { businessDate: 'asc' } }),
        this.db.expenseHead.findMany({ where }),
        this.db.expense.findMany({ where, orderBy: { createdAt: 'asc' } }),
        this.db.scan.findMany({ where, include: { pages: true }, orderBy: { createdAt: 'asc' } }),
        this.db.scanLine.findMany({ where: { scan: where }, orderBy: [{ scanId: 'asc' }, { lineNo: 'asc' }] }),
        this.db.auditLog.findMany({ where, orderBy: { at: 'asc' } }),
      ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Shop Inventory ERP';
    wb.created = new Date();
    addSheet(wb, 'Shop', shop);
    addSheet(wb, 'Users', users, ['passwordHash', 'pinHash', 'failedLogins', 'lockedUntil']);
    addSheet(wb, 'Categories', categories);
    addSheet(wb, 'Products', products);
    addSheet(wb, 'Product units', units);
    addSheet(wb, 'Product aliases', aliases);
    addSheet(wb, 'Price history', prices);
    addSheet(wb, 'Parties', parties);
    addSheet(wb, 'Documents', documents);
    addSheet(wb, 'Document lines', lines);
    addSheet(wb, 'Stock movements', movements);
    addSheet(wb, 'Receipts', receipts);
    addSheet(wb, 'Payments', payments);
    addSheet(wb, 'Ledger', ledger);
    addSheet(wb, 'Day closings', closings);
    addSheet(wb, 'Expense heads', heads);
    addSheet(wb, 'Expenses', expenses);
    addSheet(wb, 'Scans', scans.map(({ pages, ...s }) => ({ ...s, pages: pages.length })));
    addSheet(wb, 'Scan lines', scanLines);
    addSheet(wb, 'Audit log', audit);

    const zip = new JSZip();
    zip.file('README.txt', README);
    zip.file('shop-data.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
    let photos = 0;
    let missing = 0;
    for (const s of scans) {
      const folder = `photos/${s.createdAt.toISOString().slice(0, 10)}_${s.type.toLowerCase()}_${s.id.slice(0, 8)}`;
      for (const p of s.pages) {
        if (!p.imageKey) continue; // removed after the retention period (FR-AI-16)
        try {
          zip.file(`${folder}/page-${p.pageNo}.${p.imageKey.split('.').pop()}`, await this.storage.get(p.imageKey));
          photos++;
        } catch {
          missing++;
        }
      }
    }
    if (missing) zip.file('photos/MISSING.txt', `${missing} photo(s) could not be read from storage when this export was made.\n`);
    await this.db.auditLog.create({ data: { shopId, userId: user.userId, action: 'data.export', entity: 'shop', entityId: shopId, after: { photos, missing } } });
    return { filename: `shop-export-${businessDate()}.zip`, zip, photos, missing };
  }
}
