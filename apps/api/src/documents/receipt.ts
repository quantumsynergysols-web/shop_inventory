import { formatRs } from '@erp/domain';
import type { DocumentView } from './documents.service.js';

export interface ShopHeader {
  name: string;
  address: string | null;
  phone: string | null;
  ntn: string | null;
  receiptFooter: string | null;
}

const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const qty = (m: number) => String(m / 1000);
const MODE: Record<string, string> = { CASH: 'Cash', BANK: 'Bank', JAZZCASH: 'JazzCash', EASYPAISA: 'Easypaisa' };

/**
 * Printable receipt (FR-RCP-01/02/05/07). One HTML page that prints on 58/80 mm thermal
 * paper and on A4/A5 (the browser's print dialog, or "Save as PDF").
 */
export function receiptHtml(shop: ShopHeader, d: DocumentView, opts: { paper?: '58' | '80' | 'a4' } = {}): string {
  const width = opts.paper === '58' ? '54mm' : opts.paper === 'a4' ? '180mm' : '76mm';
  const voided = d.status === 'VOIDED';
  const rows = d.lines
    .map((l) => `<tr><td>${esc(l.productName)}<div class="sub">${qty(l.qtyMilli)} ${esc(l.unit)} × ${formatRs(l.ratePaisa).replace('Rs ', '')}</div></td><td class="r">${formatRs(l.amountPaisa).replace('Rs ', '')}</td></tr>`)
    .join('');
  const paid = d.payments.map((p) => `<tr><td>Paid (${MODE[p.mode] ?? p.mode})</td><td class="r">${formatRs(p.amountPaisa).replace('Rs ', '')}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipt ${esc(d.receiptNo ?? d.docNo)}</title>
<style>
@page{size:${opts.paper === 'a4' ? 'A4' : width + ' auto'};margin:${opts.paper === 'a4' ? '15mm' : '2mm'}}
body{margin:0;background:#fff;color:#111;font:12px/1.45 ui-monospace,Consolas,monospace}
.rc{width:${width};margin:0 auto;padding:6px 0;position:relative}
h1{font:700 15px system-ui,sans-serif;text-align:center;margin:0}
.c{text-align:center}.sub{color:#555;font-size:11px}.r{text-align:right;white-space:nowrap;vertical-align:top}
table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}
hr{border:0;border-top:1px dashed #888;margin:6px 0}.b td{font-weight:700;font-size:13px}
.ur{font-family:'Noto Nastaliq Urdu','Jameel Noori Nastaleeq',serif;direction:rtl;line-height:2}
.void{position:absolute;inset:30% 0 auto;text-align:center;font:900 46px system-ui;color:rgba(200,0,0,.28);transform:rotate(-20deg)}
@media screen{body{background:#eee}.rc{background:#fff;padding:12px;margin:12px auto;box-shadow:0 2px 8px rgba(0,0,0,.15)}}
</style></head><body><div class="rc">
${voided ? '<div class="void">VOID</div>' : ''}
<h1>${esc(shop.name)}</h1>
${shop.address ? `<div class="c">${esc(shop.address)}</div>` : ''}${shop.phone ? `<div class="c">${esc(shop.phone)}</div>` : ''}${shop.ntn ? `<div class="c">NTN ${esc(shop.ntn)}</div>` : ''}
<hr><table><tr><td>Receipt ${esc(d.receiptNo ?? d.docNo)}</td><td class="r">${esc(d.docDate)}</td></tr>
<tr><td>Customer</td><td class="r">${esc(d.party?.name ?? 'Walk-in')}</td></tr></table>
<hr><table>${rows}</table><hr>
<table>${d.discountPaisa ? `<tr><td>Subtotal</td><td class="r">${formatRs(d.subtotalPaisa).replace('Rs ', '')}</td></tr><tr><td>Discount</td><td class="r">-${formatRs(d.discountPaisa).replace('Rs ', '')}</td></tr>` : ''}
<tr class="b"><td>TOTAL</td><td class="r">${formatRs(d.totalPaisa)}</td></tr>${paid}
${d.balanceDuePaisa ? `<tr class="b"><td>Balance (udhaar)</td><td class="r">${formatRs(d.balanceDuePaisa)}</td></tr>` : ''}</table>
<hr>${shop.receiptFooter ? `<div class="c">${esc(shop.receiptFooter)}</div>` : ''}
<div class="c ur">یہ ایف بی آر سے تصدیق شدہ ٹیکس انوائس نہیں ہے۔</div>
<div class="c sub">This is not an FBR-verified tax invoice.</div>
</div></body></html>`;
}

/** FR-RCP-03: text for WhatsApp; v1 uses the wa.me share link (no WhatsApp Business API). */
export function receiptText(shop: ShopHeader, d: DocumentView): string {
  const lines = d.lines.map((l) => `${l.productName} × ${qty(l.qtyMilli)} = ${formatRs(l.amountPaisa)}`);
  return [
    `*${shop.name}*`,
    `Receipt ${d.receiptNo ?? d.docNo} · ${d.docDate}`,
    `Customer: ${d.party?.name ?? 'Walk-in'}`,
    '',
    ...lines,
    '',
    `Total: ${formatRs(d.totalPaisa)}`,
    ...(d.paidPaisa ? [`Paid: ${formatRs(d.paidPaisa)}`] : []),
    ...(d.balanceDuePaisa ? [`Balance: ${formatRs(d.balanceDuePaisa)}`] : []),
    ...(d.status === 'VOIDED' ? ['*VOID*'] : []),
    '',
    'This is not an FBR-verified tax invoice.',
  ].join('\n');
}
