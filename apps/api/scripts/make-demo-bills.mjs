// Draws the two sample handwritten bills of prototype v0.2 as PNG photos with the installed Chrome,
// and writes the demo provider's recorded reading for each (apps/api/demo-fixtures/*.json, keyed by SHA-256).
// The readings are what a vision model would return, including its mistakes, so the demo shows the checks.
// Usage: node apps/api/scripts/make-demo-bills.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo-fixtures');
mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const W = 600;
const H = 820;
const TOP = 176; // first row
const ROW = 46;

const bills = {
  purchase: {
    head: 'AL-MADINA SANITARY STORE',
    sub: 'Pipes · Fittings · Electric · Brandreth Road, Lahore',
    no: 'Bill # 2417',
    date: '10/11/26',
    party: 'Al-Madina Sanitary',
    lines: [
      ['PVC pipe 1" 10ft', 50, 450],
      ['Elbow 1"', 100, 35],
      ['Ceiling fan 48"', 12, 3850],
      ['8 gang board', 30, 620],
      ['Dinner set 24pc', 6, 7500],
      ['Ball valve ½', 40, 260],
    ],
    // what the "AI" got wrong or was unsure about
    reading: { dropSerial: 5, lowConfidence: { 6: 0.71 } },
  },
  sale: {
    head: 'HAJI SANITARY & ELECTRIC',
    sub: 'Shop 14, Hall Road, Lahore',
    no: 'Bill # 0883',
    date: '17/11/26',
    party: 'Rana Builders',
    lines: [
      ['PVC pipe 1"', 10, 650],
      ['Elbow 1"', 25, 60],
      ['Fan 48"', 2, 4800],
      ['8 gang board', 30, 780],
      ['Tee ¾', 60, 45],
      ['Gate valve 1"', 4, 1350],
    ],
    reading: { dropSerial: null, lowConfidence: {} },
  },
};

const fmt = (n) => n.toLocaleString('en-US');

for (const [key, b] of Object.entries(bills)) {
  const total = b.lines.reduce((s, [, q, r]) => s + q * r, 0);
  const rows = b.lines
    .map(([name, q, r], i) => `<div class="bl" style="top:${TOP + i * ROW}px"><span class="s">${i + 1}</span><span class="nm">${name.replace(/"/g, '&quot;')}</span><span class="q">${q}</span><span class="a">${fmt(q * r)}</span></div>`)
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=IBM+Plex+Sans:wght@400;700&display=block">
<style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#d9d4c7}
.paper{position:absolute;inset:14px 16px 18px 20px;background:#fffdf6;border-radius:4px;box-shadow:0 10px 30px rgba(0,0,0,.25);transform:rotate(-0.6deg);
 background-image:repeating-linear-gradient(180deg,transparent 0 ${ROW - 1}px,#cfd9ef ${ROW - 1}px ${ROW}px);background-position:0 ${TOP - 14 - 6}px}
.paper:before{content:"";position:absolute;left:46px;top:0;bottom:0;width:2px;background:#e7a0a0}
.hd{position:absolute;left:0;right:0;top:20px;text-align:center;color:#b3261e;font:700 26px 'IBM Plex Sans',sans-serif;letter-spacing:.03em}
.hd small{display:block;font:400 14px 'IBM Plex Sans',sans-serif;color:#8a5a55;letter-spacing:0;margin-top:4px}
.rule{position:absolute;left:20px;right:20px;top:90px;border-top:3px solid #b3261e}
.mt{position:absolute;left:62px;right:28px;top:106px;display:flex;justify-content:space-between;font:600 30px 'Caveat',cursive;color:#1d2a8f}
.bl{position:absolute;left:14px;right:28px;height:${ROW}px;display:grid;grid-template-columns:34px 1fr 70px 110px;gap:10px;align-items:end;font:600 36px/1 'Caveat',cursive;color:#1d2a8f;padding-bottom:6px;box-sizing:border-box}
.bl .s{font-size:26px;color:#6a6f99;text-align:center}.bl .a{text-align:right}.bl .q{text-align:right}
.tt{position:absolute;left:62px;right:28px;top:${TOP + b.lines.length * ROW + 16}px;border-top:3px solid #1d2a8f;display:flex;justify-content:space-between;font:700 40px 'Caveat',cursive;color:#1d2a8f;padding-top:4px}
.sig{position:absolute;right:40px;bottom:40px;font:500 32px 'Caveat',cursive;color:#1d2a8f;transform:rotate(-6deg)}
</style></head><body><div class="paper">
<div class="hd">${b.head}<small>${b.sub}</small></div><div class="rule"></div>
<div class="mt"><span>${b.no}</span><span>${b.date}</span></div>
${rows}
<div class="tt"><span>Total</span><span>${fmt(total)}/-</span></div>
<div class="sig">${key === 'sale' ? 'Rana Builders' : 'Shukriya'}</div>
</div></body></html>`;
  const tmp = join(tmpdir(), `erp-bill-${key}.html`);
  writeFileSync(tmp, html);
  const png = join(out, `${key}-bill.png`);
  rmSync(png, { force: true });
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`, '--virtual-time-budget=8000', `--screenshot=${png}`, `file:///${tmp.replace(/\\/g, '/')}`], { stdio: 'ignore' });
  const bytes = readFileSync(png);
  const sha = createHash('sha256').update(bytes).digest('hex');

  const lines = b.lines
    .map(([name, q, r], i) => ({ serial: i + 1, name, q, r }))
    .filter((l) => l.serial !== b.reading.dropSerial)
    .map((l) => ({
      line_no: l.serial,
      raw_name: l.name,
      qty: l.q,
      unit: null,
      rate: l.r,
      line_total: l.q * l.r,
      confidence: b.reading.lowConfidence[l.serial] ?? 0.96,
      // [x, y, w, h] as fractions of the photo, for the crop shown beside each row (FR-REV-14)
      bbox: [0.03, Number(((TOP + (l.serial - 1) * ROW + 14) / H).toFixed(4)), 0.92, Number((ROW / H).toFixed(4))],
    }));
  const fixture = {
    sha256: sha,
    description: `Sample ${key} bill from prototype v0.2 (made-up shop and amounts). Recorded demo reading${b.reading.dropSerial ? `; row ${b.reading.dropSerial} deliberately missed` : ''}.`,
    result: { partyName: b.party, billNo: b.no.replace('Bill # ', ''), date: null, billTotal: total, lines },
  };
  writeFileSync(join(out, `${key}-bill.json`), JSON.stringify(fixture, null, 2) + '\n');
  console.log(`${key}: ${png} (${bytes.length} bytes) sha ${sha.slice(0, 12)}… total ${total}`);
}
