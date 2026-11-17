// Records the product demo video (phase 5).
//
//   npm run build            (domain, API and web app)
//   node scripts/record-demo.mjs
//
// What it does:
// 1. Creates/clears a separate database "<DATABASE_URL db>_demo" and fills it with a sample shop.
// 2. Starts the API (which also serves the web app) on port 3100 against that database.
// 3. Drives the installed Chrome with Playwright through the main flows in a phone frame,
//    with captions on the side. Frames come from Chrome's own screencast (CDP) and the installed
//    ffmpeg turns them into docs/demo/shop-erp-demo.mp4 (no extra downloads).
// Shop, people and amounts are made up. The AI reading is the recorded demo reading.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = join(root, 'apps/api');
const outDir = join(root, 'docs/demo');
// Urdu narration, one clip per step (FameSpeak voice "Asad", ur-PK): docs/demo/voice/step-NN.mp3
const voiceDir = join(outDir, 'voice');
const clip = (n) => join(voiceDir, `step-${String(n).padStart(2, '0')}.mp3`);
const clipSeconds = (n) => (existsSync(clip(n)) ? Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clip(n)]).toString().trim()) : 0);
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
// Demo-only login for the throwaway demo database (shown masked in the video).
const OWNER = { phone: '03001234567', password: 'demo-owner-2026', name: 'Haji Sb' };

function env() {
  const vars = {};
  for (const line of readFileSync(join(api, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

const fileEnv = env();
const demoUrl = new URL(fileEnv.DATABASE_URL);
const demoDb = demoUrl.pathname.slice(1) + '_demo';
demoUrl.pathname = '/' + demoDb;

async function prepareDatabase() {
  const admin = new URL(fileEnv.DATABASE_URL);
  admin.pathname = '/postgres';
  const a = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  const exists = await a.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = '${demoDb}'`);
  if (exists.length === 0) await a.$executeRawUnsafe(`CREATE DATABASE "${demoDb}"`);
  await a.$disconnect();
  execFileSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(api, 'prisma/schema.prisma')], {
    env: { ...process.env, DATABASE_URL: demoUrl.toString() },
    stdio: 'ignore',
  });
  const db = new PrismaClient({ datasources: { db: { url: demoUrl.toString() } } });
  const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  const shop = await db.shop.create({
    data: {
      name: 'Haji Sanitary & Electric',
      address: 'Shop 14, Hall Road, Lahore',
      phone: '042-37000000',
      receiptFooter: 'Shukriya! Dobara tashreef layein',
      settings: { markupPct: 25, allowNegativeStock: false, lowStockDefault: 5, salesmanMayCloseDay: false, salesmanExpenseLimitPaisa: 100000, closingNoteLimitPaisa: 50000 },
      categories: { create: ['Plumbing', 'Sanitary', 'Electrical', 'Crockery', 'Hardware', 'General'].map((name) => ({ name })) },
      expenseHeads: { create: ['Tea / food', 'Labour', 'Transport', 'Electricity', 'Salary', 'Other'].map((name) => ({ name })) },
      aiSetting: { create: {} },
    },
  });
  await db.user.create({ data: { shopId: shop.id, name: OWNER.name, phone: OWNER.phone, role: 'OWNER', passwordHash: await hash(OWNER.password) } });
  await db.party.create({ data: { shopId: shop.id, name: 'Walk-in', normalizedName: 'walk in', type: 'CUSTOMER' } });
  // Yesterday was closed with Rs 15,000 in the galla: today's opening cash.
  const y = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date()) + 'T00:00:00Z');
  y.setUTCDate(y.getUTCDate() - 1);
  await db.dayClosing.create({ data: { shopId: shop.id, businessDate: y, status: 'CLOSED', countedCashPaisa: 1500000n, expectedCashPaisa: 1500000n, differencePaisa: 0n } });
  await db.$disconnect();
}

async function startServer() {
  const storage = join(tmpdir(), 'erp-demo-storage');
  rmSync(storage, { recursive: true, force: true });
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: api,
    env: { ...process.env, DATABASE_URL: demoUrl.toString(), JWT_SECRET: fileEnv.JWT_SECRET, PORT: String(PORT), STORAGE_DIR: storage },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if ((await r.json()).db === 'up') return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error('demo server did not start');
}

async function seedThroughApi() {
  const login = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: OWNER.phone, password: OWNER.password }) })).json();
  const H = { 'content-type': 'application/json', authorization: `Bearer ${login.accessToken}` };
  const call = async (m, p, b) => {
    const r = await fetch(`${BASE}/api${p}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
    const j = await r.json();
    if (!r.ok) throw new Error(`${p}: ${JSON.stringify(j)}`);
    return j;
  };
  const cats = await call('GET', '/categories');
  const cat = (n) => cats.find((c) => c.name === n).id;
  const P = {};
  for (const [k, name, c, buy, sell, min] of [
    ['pipe', 'PVC Pipe 1 inch – 10 ft', 'Plumbing', 450, 650, 15],
    ['elbow', 'Elbow Joint 1 inch', 'Plumbing', 35, 60, 30],
    ['fan', 'Ceiling Fan 48 inch', 'Electrical', 3850, 4800, 4],
    ['board', 'Switch Board 8-gang', 'Electrical', 600, 780, 10],
    ['ball', 'Ball Valve ½ inch', 'Sanitary', 260, 340, 10],
    ['gate', 'Gate Valve 1 inch', 'Sanitary', 1050, 1350, 6],
    ['tee', 'Tee Joint ¾ inch', 'Plumbing', 30, 45, 40],
    ['wire', 'Copper Wire 7/29 – coil', 'Electrical', 9800, 11500, 5],
    ['cups', 'Tea Cup Set 6 pcs', 'Crockery', 900, 1300, 6],
  ]) {
    P[k] = (await call('POST', '/products', { name, categoryId: cat(c), purchasePricePaisa: buy * 100, salePricePaisa: sell * 100, minLevel: min })).id;
  }
  const opening = (await call('POST', '/parties', { name: 'Opening stock', type: 'SUPPLIER' })).id;
  await call('POST', '/parties', { name: 'Al-Madina Sanitary Store', type: 'SUPPLIER', phone: '042-37111111' });
  await call('POST', '/parties', { name: 'Rana Builders', type: 'CUSTOMER', phone: '0300-7654321', openingBalancePaisa: 1200000 });
  await call('POST', '/documents', {
    kind: 'PURCHASE',
    partyId: opening,
    lines: [['pipe', 20, 450], ['elbow', 40, 35], ['board', 8, 600], ['ball', 12, 260], ['gate', 9, 1050], ['tee', 45, 30], ['wire', 3, 9800], ['cups', 14, 900]].map(([k, q, r]) => ({ productId: P[k], qtyMilli: q * 1000, ratePaisa: r * 100 })),
    payments: [{ mode: 'BANK', amountPaisa: 6158000 }],
  });
  await call('POST', '/documents', { kind: 'SALE', lines: [{ productId: P.cups, qtyMilli: 2000, ratePaisa: 130000 }], payments: [{ mode: 'CASH', amountPaisa: 260000 }] });
}

const STAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&display=block">
<style>
html,body{margin:0;width:1280px;height:720px;overflow:hidden;font-family:'IBM Plex Sans',system-ui,sans-serif;background:radial-gradient(circle at 25% 40%,#28317a,#0d1130 70%);color:#fff}
.phone{position:absolute;left:96px;top:14px;width:356px;height:692px;border-radius:44px;background:#05060c;padding:10px;box-shadow:0 30px 70px rgba(0,0,0,.55)}
iframe{width:356px;height:692px;border:0;border-radius:34px;background:#f6f7fa}
.panel{position:absolute;left:540px;top:0;right:60px;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:16px}
.brand{position:absolute;left:540px;top:34px;font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:#9fb0ff}
.step{font-size:15px;color:#9fb0ff;font-weight:600}
h1{margin:0;font-size:38px;line-height:1.2;font-weight:700}
.en{font-size:19px;line-height:1.5;color:#c9d0f5}
.req{font-size:13px;color:#7f8ac2}
.foot{position:absolute;left:540px;bottom:28px;font-size:12px;color:#7f8ac2}
.tap{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,212,0,.55);border:3px solid #ffd400;pointer-events:none;z-index:9;transition:transform .35s,opacity .35s}
</style></head><body>
<div class="phone"><iframe id="phone" src="about:blank" allow="clipboard-read"></iframe></div>
<div class="brand">Shop Inventory ERP · Photo Scan · QSSols</div>
<div class="panel"><div class="step" id="step"></div><h1 id="title"></h1><div class="en" id="en"></div><div class="req" id="req"></div></div>
<div class="foot">Demo with made-up shop data. No AI key is set, so the bill reading is a recorded demo reading.</div>
</body></html>`;

async function record() {
  mkdirSync(outDir, { recursive: true });
  const framesDir = join(tmpdir(), 'erp-demo-frames');
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.setContent(STAGE);
  // Chrome sends a frame whenever the screen changes; each frame is kept with its time.
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(framesDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  await page.waitForTimeout(800);
  const frame = page.frameLocator('#phone');
  let n = 0;
  let talkingUntil = 0;
  const cues = [];

  /**
   * Shows a caption and starts its narration clip. The screen waits for the narration to finish,
   * unless `overlap` is set: then the following actions play while the narrator describes them.
   */
  const say = async (title, en, req = '', ms = 2600, { overlap = false } = {}) => {
    n++;
    const wait = talkingUntil - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    const dur = clipSeconds(n);
    if (dur) {
      cues.push({ file: clip(n), at: Date.now() / 1000 });
      talkingUntil = Date.now() + (dur + 0.35) * 1000;
      if (!overlap) ms = Math.max(ms, (dur + 0.5) * 1000);
    }
    await page.evaluate(([s, t, e, r]) => {
      document.getElementById('step').textContent = s;
      document.getElementById('title').textContent = t;
      document.getElementById('en').textContent = e;
      document.getElementById('req').textContent = r;
    }, [`Step ${n}`, title, en, req]);
    await page.waitForTimeout(ms);
  };
  const tap = async (loc, pause = 700) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (b) {
      await page.evaluate(([x, y]) => {
        const d = document.createElement('div');
        d.className = 'tap';
        d.style.left = x + 'px';
        d.style.top = y + 'px';
        document.body.appendChild(d);
        setTimeout(() => { d.style.transform = 'scale(1.6)'; d.style.opacity = '0'; }, 250);
        setTimeout(() => d.remove(), 800);
      }, [b.x + b.width / 2, b.y + b.height / 2]);
    }
    await page.waitForTimeout(350);
    await loc.click();
    await page.waitForTimeout(pause);
  };
  const type = async (loc, text) => {
    await tap(loc, 200);
    await loc.fill('');
    await loc.pressSequentially(text, { delay: 70 });
    await page.waitForTimeout(400);
  };
  const scroll = async (px, ms = 1200) => {
    await page.mouse.move(270, 380);
    await page.mouse.wheel(0, px);
    await page.waitForTimeout(ms);
  };
  const appFrame = () => page.frames().find((f) => f.url().startsWith(BASE));

  // 1. Login
  await page.evaluate((u) => (document.getElementById('phone').src = u), `${BASE}/`);
  await frame.locator('input[autocomplete=username]').waitFor();
  await say('Urdu pehle, English bhi', 'The app opens in Urdu (Nastaliq). Owner logs in with phone and password.', 'FR-AUTH-01 · C-6');
  await type(frame.locator('input[autocomplete=username]'), OWNER.phone);
  await type(frame.locator('input[type=password]'), OWNER.password);
  await tap(frame.getByRole('button', { name: 'داخل ہوں' }), 1800);

  // 2. Home
  await frame.getByText('Haji Sanitary & Electric').waitFor();
  await say('Home: aaj ka hisaab ek nazar mein', 'Stock value, today’s purchases and sales, net profit, and low-stock items.', 'FR-DSH-01..03', 3200);
  await scroll(500, 1600);
  await scroll(-500, 800);

  // 3. Purchase scan
  await say('Supplier ka bill: photo lein', 'Purchase (Stock IN): take a photo of the supplier’s handwritten letterpad.', 'FR-SCAN-01..04', 1800, { overlap: true });
  await tap(frame.locator('a.bigbtn.in'), 900);
  await frame.locator('input[type=file]').setInputFiles(join(api, 'demo-fixtures/purchase-bill.png'));
  await page.waitForTimeout(1500);
  await tap(frame.getByRole('button', { name: 'بل پڑھیں' }), 600);
  await say('AI bill parhta hai', 'Each page is read; rows, quantities, rates and totals are checked.', 'FR-AI-01..06', 1400, { overlap: true });
  await frame.getByText('بل چیک کریں').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await say('Ghalti pakri gayi: row 5 gum hai', 'Serial 5 is missing from the reading and the total does not match, so the app warns instead of trusting the AI.', 'FR-AI-12/13 · NFR-ACC-02', 3600);
  await say('Har line ke saath photo ka tukda', 'Each row shows its crop from the photo. Supplier was matched from the name on the bill.', 'FR-REV-01/06/14 · FR-PTY-04', 3000);
  await scroll(330, 2200);
  await say('Gum row khud shamil karein', 'Add the missed row: type it, create the new product, set qty and rate.', 'FR-REV-02/10/15', 1500, { overlap: true });
  await tap(frame.getByRole('button', { name: 'لائن شامل کریں' }), 900);
  await type(frame.getByLabel('کاغذ پر لکھا'), 'Dinner set 24pc');
  await type(frame.getByPlaceholder('پروڈکٹ تلاش کریں'), 'dinner set');
  await page.waitForTimeout(900);
  await tap(frame.locator('.sheet button.choice', { hasText: 'نئی پروڈکٹ بنائیں' }), 700);
  await type(frame.locator('.sheet .card').getByLabel('نام'), 'Dinner Set 24 pcs');
  await type(frame.locator('.sheet .card').getByLabel('قیمتِ خرید'), '7500');
  await tap(frame.locator('.sheet .card button.cta', { hasText: 'نئی پروڈکٹ بنائیں' }), 1200);
  await type(frame.locator('.sheet').getByLabel('مقدار'), '6');
  await type(frame.locator('.sheet').getByLabel('ریٹ'), '7500');
  await page.waitForTimeout(600);
  await tap(frame.locator('.sheet').getByRole('button', { name: 'ٹھیک ہے' }), 1600);
  await scroll(900, 1400);
  await say('Ab jod bill ke total ke barabar', 'Line total now equals the bill total. Confirm moves the stock in one transaction.', 'FR-STK-01 · BR-2', 2600);
  await tap(frame.getByRole('button', { name: 'خریداری محفوظ کریں (اسٹاک اِن)' }), 2200);
  await frame.getByText('خریداری محفوظ ہو گئی').waitFor();
  await say('Stock barh gaya', 'Stock before → after for every item; purchase prices and the supplier balance are updated.', 'FR-STK-02/03 · FR-REV-09', 3400);
  await scroll(400, 1500);

  // 4. Sale scan
  await tap(frame.getByRole('button', { name: 'ہوم پر جائیں' }), 1200);
  await say('Ab sale ka bill', 'Sale (Stock OUT): photo of the shop’s handwritten sale bill.', 'UC-02', 1600, { overlap: true });
  await tap(frame.locator('a.bigbtn.out'), 900);
  await frame.locator('input[type=file]').setInputFiles(join(api, 'demo-fixtures/sale-bill.png'));
  await page.waitForTimeout(1300);
  await tap(frame.getByRole('button', { name: 'بل پڑھیں' }), 600);
  await frame.getByText('بل چیک کریں').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  await say('Stock kam hai: sale ruk gayi', 'The bill asks for 60 Tee joints but only 45 are in stock, so Confirm is blocked.', 'FR-REV-07', 3400, { overlap: true });
  await tap(frame.locator('.ln', { hasText: 'Tee Joint' }), 900);
  await type(frame.locator('.sheet').getByLabel('مقدار'), '45');
  await tap(frame.locator('.sheet').getByRole('button', { name: 'ٹھیک ہے' }), 1500);
  await say('Customer photo se mila, udhaar bhi', 'Rana Builders pays Rs 30,000 now; the rest goes to his udhaar.', 'FR-REV-12 · BR-7', 1800, { overlap: true });
  await scroll(1400, 1000);
  await type(frame.getByLabel('وصول رقم'), '30000');
  await page.waitForTimeout(1200);
  await tap(frame.getByRole('button', { name: 'فروخت محفوظ کریں اور رسید بنائیں' }), 2200);
  await frame.getByText('فروخت محفوظ ہو گئی').waitFor();
  await say('Rasid tayyar: print ya WhatsApp', 'Remaining stock and low-stock warnings, then the receipt for thermal print or WhatsApp.', 'FR-RCP-01..07 · FR-STK-04', 3000);
  await scroll(500, 1800);
  await scroll(500, 2600);

  // 5. Day closing
  await tap(frame.getByRole('button', { name: 'ہوم پر جائیں' }), 1200);
  await say('Din band karna', 'Day-end closing: sales by cash, bank and udhaar, profit, expenses and the galla count.', 'SRS §3.10a · BR-8/9', 1600, { overlap: true });
  await tap(frame.locator('a[href="#/day"]'), 1600);
  await scroll(350, 1800);
  await tap(frame.getByRole('button', { name: '+ خرچ درج کریں' }), 800);
  await tap(frame.locator('.sheet .chips button', { hasText: 'Tea / food' }), 400);
  await type(frame.locator('.sheet input.cashin'), '450');
  await tap(frame.locator('.sheet').getByRole('button', { name: 'خرچ درج کریں' }), 1500);
  await scroll(900, 1200);
  const expected = await appFrame().evaluate(() => {
    const row = [...document.querySelectorAll('.rw.tot')].find((r) => r.textContent.includes('متوقع کیش'));
    return Number(row.querySelector('.n').textContent.replace(/[^0-9.]/g, ''));
  });
  await say('Galla gin kar likhein', `Expected cash is Rs ${expected.toLocaleString('en-US')}. The owner counts Rs 200 less.`, 'FR-CLS-03/04/06', 1600, { overlap: true });
  await type(frame.locator('#counted'), String(expected - 200));
  await page.waitForTimeout(1500);
  await tap(frame.getByRole('button', { name: 'دن بند کریں' }), 1800);
  await say('Din band, kal ka opening tayyar', 'Counted cash becomes tomorrow’s opening cash; the closed day is locked.', 'FR-CLS-04/05 · BR-10', 3000);

  // 6. Ledger and stock
  await tap(frame.getByRole('button', { name: 'Back' }), 1000);
  await tap(frame.locator('a[href="#/ledger"]'), 1600);
  await say('Khaata: kis se lena, kis ko dena', 'Customer receivables and supplier payables, with history and payments.', 'FR-PTY-01..03 · FR-RPT-05', 3000);
  await tap(frame.locator('a[href="#/stock"]'), 1600);
  await say('Stock list, kam stock laal', 'Search by name, alias or SKU with typo tolerance; low stock in red. Excel export.', 'FR-PRD-02 · FR-RPT-03/04', 3000);

  // 7. English
  await tap(frame.locator('a[href="#/home"]'), 1200);
  await tap(frame.getByRole('button', { name: 'EN' }), 1600);
  await say('English bhi', 'One tap switches the whole app to English.', 'NFR-USE-02', 3200);
  await say('Shukriya', 'Shop Inventory ERP – Photo Scan · built to SRS v1.1 · github.com/quantumsynergysols-web/shop_inventory', '', 3500);

  await page.waitForTimeout(500);
  await cdp.send('Page.stopScreencast');
  const end = Date.now() / 1000;
  await context.close();
  await browser.close();
  // ffmpeg concat list: every frame stays on screen until the next one arrived.
  const fwd = (p) => p.split('\\').join('/');
  const list = frames.map((f, i) => `file '${fwd(f.file)}'\nduration ${Math.max(0.001, (frames[i + 1]?.t ?? end) - f.t).toFixed(3)}`);
  list.push(`file '${fwd(frames[frames.length - 1].file)}'`);
  const listFile = join(framesDir, 'list.txt');
  writeFileSync(listFile, list.join('\n') + '\n');
  console.log(`${frames.length} frames, ${(end - frames[0].t).toFixed(0)} s, ${cues.length} narration clips`);
  return { listFile, cues, start: frames[0].t };
}

await prepareDatabase();
const server = await startServer();
let rec;
try {
  await seedThroughApi();
  rec = await record();
} finally {
  server.kill();
}
const mp4 = join(outDir, 'shop-erp-demo.mp4');
const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', rec.listFile];
for (const c of rec.cues) args.push('-i', c.file);
if (rec.cues.length) {
  // Each clip starts at the moment its caption appeared.
  const delays = rec.cues.map((c, i) => { const ms = Math.max(0, Math.round((c.at - rec.start) * 1000)); return `[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`; });
  const filter = `${delays.join(';')};${rec.cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${rec.cues.length}:normalize=0:duration=longest[aout]`;
  args.push('-filter_complex', filter, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k');
}
args.push('-vf', 'fps=25,format=yuv420p', '-c:v', 'libx264', '-crf', '21', '-preset', 'medium', '-movflags', '+faststart', mp4);
execFileSync('ffmpeg', args);
console.log(existsSync(mp4) ? `video: ${mp4}` : 'MP4 not created');
