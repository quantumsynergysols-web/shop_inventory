// Records the "how to use" video of the desktop app (desktop layout, 1280x720), in Urdu or English.
//
//   npm run build && npm run build --workspace @erp/web
//   node scripts/make-music.mjs            (once: writes docs/demo/music/howto-bed.mp3)
//   node scripts/record-howto.mjs          -> docs/demo/shop-erp-howto-ur.mp4
//   node scripts/record-howto.mjs --en     -> docs/demo/shop-erp-howto-en.mp4 (English app, captions and
//                                             narration from docs/demo/voice-howto-en, made by scripts/make-voice-en.ps1)
//   node scripts/record-howto.mjs --shots  also saves a screenshot per step to docs/demo/howto-shots/
//
// Same approach as scripts/record-demo.mjs (which stays as it is):
// 1. Creates/clears "<DATABASE_URL db>_demo" and leaves it EMPTY, so the first-run setup screen shows,
//    as on a freshly installed desktop app (API started with SETUP_ENABLED=true).
// 2. Starts the API (it also serves apps/web/dist) on port 3100 against that database.
// 3. Drives the installed Chrome (playwright-core) at 1280x720 in Urdu; frames come from Chrome's CDP
//    screencast; the installed ffmpeg builds the MP4, places each narration clip
//    (docs/demo/voice-howto/step-NN.mp3) at its caption time and mixes the background music under it,
//    ducked while the voice speaks.
// Shop, people and amounts are made up. No AI key is set: the bill reading is the recorded demo reading.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PrismaClient } from '@prisma/client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = join(root, 'apps/api');
const outDir = join(root, 'docs/demo');
const EN = process.argv.includes('--en');
const voiceDir = join(outDir, EN ? 'voice-howto-en' : 'voice-howto');
const musicFile = join(outDir, 'music/howto-bed.mp3');
const OUT = join(outDir, EN ? 'shop-erp-howto-en.mp4' : 'shop-erp-howto-ur.mp4');
const SHOTS = process.argv.includes('--shots') ? join(outDir, 'howto-shots') : null;
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
// Demo-only login for the throwaway demo database (the password is typed into a masked field).
const OWNER = { phone: '03001234567', password: 'demo-owner-2026', name: 'Haji Bilal' };
const SHOP = 'Noor Sanitary & Electric';
// Button and label text as the app shows it (apps/web/src/i18n.tsx).
const UI_UR = {
  setupGo: 'دکان بنائیں اور شروع کریں', newProduct: 'نئی پروڈکٹ', name: 'نام', category: 'کیٹیگری', purchasePrice: 'قیمتِ خرید', salePrice: 'قیمتِ فروخت', minLevel: 'کم از کم حد', save: 'محفوظ کریں',
  upload: 'بل پڑھیں', review: 'بل چیک کریں', addLine: 'لائن شامل کریں', written: 'کاغذ پر لکھا', searchProduct: 'پروڈکٹ تلاش کریں', qty: 'مقدار', rate: 'ریٹ', ok: 'ٹھیک ہے',
  confirmIn: 'خریداری محفوظ کریں (اسٹاک اِن)', doneIn: 'خریداری محفوظ ہو گئی', received: 'وصول رقم', confirmOut: 'فروخت محفوظ کریں اور رسید بنائیں', doneOut: 'فروخت محفوظ ہو گئی',
  recordPayment: 'ادائیگی درج کریں', setStart: 'درج کریں', startQ: 'دکان شروع کرتے وقت', addExp: 'خرچ درج کریں', expected: 'متوقع کیش', closeBtn: 'دن بند کریں', dataSafety: 'ڈیٹا کی حفاظت', aiSettings: 'AI بل ریڈنگ',
  print: 'پرنٹ',
};
const UI_EN = {
  setupGo: 'Create shop and start', newProduct: 'New product', name: 'Name', category: 'Category', purchasePrice: 'Purchase price', salePrice: 'Sale price', minLevel: 'Reorder level', save: 'Save',
  upload: 'Read the bill', review: 'Review bill', addLine: 'Add line', written: 'Written on paper', searchProduct: 'Search product', qty: 'Quantity', rate: 'Rate', ok: 'Done',
  confirmIn: 'Save purchase (stock in)', doneIn: 'Purchase saved', received: 'Amount received', confirmOut: 'Save sale & create receipt', doneOut: 'Sale saved',
  recordPayment: 'Record payment', setStart: 'Set', startQ: 'when you started using the app', addExp: 'Add expense', expected: 'Expected cash', closeBtn: 'Close the day', dataSafety: 'Data safety', aiSettings: 'AI bill reading',
  print: 'Print',
};
const UI = EN ? UI_EN : UI_UR;
// One caption per narration clip, in order.
const CAPTIONS_UR = [
  'شاپ ای آر پی — استعمال کا طریقہ',
  'پہلی بار سیٹ اپ',
  'ہوم: آج کا حساب ایک نظر میں',
  'اسٹاک: نئی پروڈکٹ',
  'خریداری: بل کی تصویر',
  'بل چیک کریں: تصویر ساتھ ساتھ',
  'چھوٹی ہوئی لائن شامل کریں',
  'محفوظ کریں، اسٹاک بڑھ گیا',
  'فروخت: کم اسٹاک پر رکاوٹ',
  'گاہک، نقد اور ادھار',
  'رسید: پرنٹ یا واٹس ایپ',
  'کھاتہ: ادھار کی وصولی',
  'ڈے کلوزنگ: اوپننگ کیش اور خرچ',
  'گلّہ گنیں، دن بند کریں',
  'ڈیٹا کی حفاظت اور AI سیٹنگ',
  'شکریہ',
];
const CAPTIONS_EN = [
  'Shop ERP — how to use it',
  'First-time setup',
  'Home: today at a glance',
  'Inventory: a new product',
  'Purchase: photo of the bill',
  'Review: the photo side by side',
  'Add the missed line',
  'Save, and stock goes up',
  'Sale: short stock is stopped',
  'Customer, cash and credit',
  'Receipt: print or WhatsApp',
  'Ledger: collecting a payment',
  'Day-end: starting cash and an expense',
  'Count the cash, close the day',
  'Data safety and AI settings',
  'Thank you',
];
const CAPTIONS = EN ? CAPTIONS_EN : CAPTIONS_UR;
const clip = (n) => join(voiceDir, `step-${String(n).padStart(2, '0')}.mp3`);
const clipSeconds = (n) => (existsSync(clip(n)) ? Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clip(n)]).toString().trim()) : 0);

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

/** Empty demo database (migrated, no rows): the app shows the first-run setup screen. */
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
  await db.$disconnect();
}

const tmpBase = join(tmpdir(), 'erp-howto');
async function startServer() {
  rmSync(tmpBase, { recursive: true, force: true });
  mkdirSync(tmpBase, { recursive: true });
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: api,
    env: {
      ...process.env,
      DATABASE_URL: demoUrl.toString(),
      JWT_SECRET: fileEnv.JWT_SECRET,
      PORT: String(PORT),
      SETUP_ENABLED: 'true',
      SIGNUP_ENABLED: 'false',
      HOSTED_AI_PROVIDER: 'none',
      STORAGE_DIR: join(tmpBase, 'storage'),
      BACKUP_DIR: join(tmpBase, 'backups'),
    },
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

/** Right after setup: opening stock (CSV import, FR-STK-08), one supplier and one customer, through the API. */
async function seedThroughApi() {
  const login = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: OWNER.phone, password: OWNER.password }) })).json();
  const auth = { authorization: `Bearer ${login.accessToken}` };
  const call = async (m, p, b) => {
    const r = await fetch(`${BASE}/api${p}`, { method: m, headers: { ...auth, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    const j = await r.json();
    if (!r.ok) throw new Error(`${p}: ${JSON.stringify(j)}`);
    return j;
  };
  const csv = [
    'name,category,unit,qty,cost,sale price,min level',
    'PVC Pipe 1 inch – 10 ft,Plumbing,pcs,20,450,650,15',
    'Elbow Joint 1 inch,Plumbing,pcs,40,35,60,30',
    'Ceiling Fan 48 inch,Electrical,pcs,0,3850,4800,4',
    'Switch Board 8-gang,Electrical,pcs,8,600,780,10',
    'Ball Valve ½ inch,Sanitary,pcs,12,260,340,10',
    'Gate Valve 1 inch,Sanitary,pcs,9,1050,1350,6',
    'Tee Joint ¾ inch,Plumbing,pcs,45,30,45,40',
    'Copper Wire 7/29 – coil,Electrical,roll,3,9800,11500,5',
    'Tea Cup Set 6 pcs,Crockery,set,14,900,1300,6',
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'opening-stock.csv');
  const r = await fetch(`${BASE}/api/opening-stock`, { method: 'POST', headers: auth, body: form });
  if (!r.ok) throw new Error(`opening-stock: ${await r.text()}`);
  await call('POST', '/parties', { name: 'Al-Madina Sanitary Store', type: 'SUPPLIER', phone: '042-37111111' });
  await call('POST', '/parties', { name: 'Rana Builders', type: 'CUSTOMER', phone: '0300-7654321', openingBalancePaisa: 1200000 });
}

// Caption box (bottom of the sidebar, which is empty below the menu), title cards and tap marks.
// Added outside React's root, so the app never removes them.
const OVERLAY_UR = `(() => {
  const css = \`
  #hx-cap{position:fixed;right:14px;bottom:16px;width:220px;z-index:2147483000;padding:14px 16px 16px;border-radius:16px;
    background:rgba(16,22,58,.92);color:#fff;box-shadow:0 12px 30px rgba(0,0,0,.28);direction:rtl;text-align:right;
    font-family:'Noto Nastaliq Urdu',serif;transition:opacity .35s,transform .35s;opacity:0;transform:translateY(8px)}
  #hx-cap.on{opacity:1;transform:none}
  #hx-cap .n{font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:12px;letter-spacing:.08em;color:#9fb0ff;font-weight:600;direction:ltr;text-align:right}
  #hx-cap .t{font-size:19px;line-height:2.05;margin-top:2px}
  #hx-card{position:fixed;inset:0;z-index:2147483001;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
    background:radial-gradient(circle at 30% 35%,#2a3486,#0d1130 72%);color:#fff;transition:opacity .8s;opacity:0;pointer-events:none}
  #hx-card.on{opacity:1}
  #hx-card .k{font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:15px;letter-spacing:.22em;color:#9fb0ff;text-transform:uppercase}
  #hx-card h1{margin:0;font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:58px;font-weight:700}
  #hx-card h2{margin:0;font-family:'Noto Nastaliq Urdu',serif;font-size:40px;font-weight:600;line-height:2;direction:rtl}
  #hx-card p{margin:0;font-family:'Noto Nastaliq Urdu',serif;font-size:21px;line-height:2.1;color:#c9d0f5;direction:rtl;text-align:center}
  #hx-card .f{position:absolute;bottom:30px;font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:13px;color:#8d97cf}
  .hx-ring{position:fixed;z-index:2147482999;border:3px solid #ffb400;border-radius:16px;box-shadow:0 0 0 6px rgba(255,180,0,.18),0 0 24px rgba(255,180,0,.35);pointer-events:none;opacity:0;transition:opacity .35s}
  .hx-ring.on{opacity:1}
  .hx-tap{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,212,0,.5);border:3px solid #ffd400;pointer-events:none;z-index:2147483002;transition:transform .35s,opacity .35s}
  \`;
  const add = () => {
    if (document.getElementById('hx-cap')) return;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    const c = document.createElement('div'); c.id = 'hx-cap'; c.innerHTML = '<div class="n"></div><div class="t"></div>'; document.body.appendChild(c);
    const k = document.createElement('div'); k.id = 'hx-card'; document.body.appendChild(k);
  };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
})()`;
// English: left-to-right, Latin font
const OVERLAY = EN
  ? OVERLAY_UR.replace('position:fixed;right:14px;bottom:16px', 'position:fixed;left:14px;bottom:16px') // the sidebar is on the left
      .replaceAll('direction:rtl;text-align:right', 'direction:ltr;text-align:left')
      .replaceAll("'Noto Nastaliq Urdu',serif", "'IBM Plex Sans',system-ui,sans-serif")
      .replace('font-size:19px;line-height:2.05', 'font-size:18px;line-height:1.4;font-weight:600')
      .replace('font-size:40px;font-weight:600;line-height:2;direction:rtl', 'font-size:34px;font-weight:600;line-height:1.3')
      .replace('font-size:21px;line-height:2.1;color:#c9d0f5;direction:rtl', 'font-size:20px;line-height:1.5;color:#c9d0f5')
      .replace('direction:ltr;text-align:right}', 'direction:ltr;text-align:left}')
  : OVERLAY_UR;

let dbgPage = null;
const errors = [];
async function record() {
  mkdirSync(outDir, { recursive: true });
  if (SHOTS) {
    rmSync(SHOTS, { recursive: true, force: true });
    mkdirSync(SHOTS, { recursive: true });
  }
  const framesDir = join(tmpBase, 'frames');
  mkdirSync(framesDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: EN ? 'en-PK' : 'ur-PK', timezoneId: 'Asia/Karachi' });
  await context.addInitScript((lang) => {
    try {
      localStorage.setItem('erp.lang', lang);
    } catch {
      /* ignore */
    }
  }, EN ? 'en' : 'ur');
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();
  dbgPage = page;
  page.on('pageerror', (e) => errors.push(String(e.stack ?? e)));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('popup', (p) => p.close().catch(() => {}));
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(framesDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });

  await page.goto(`${BASE}/`);
  await page.locator('#setup-shopName').waitFor({ timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });

  let n = 0;
  let talkingUntil = 0;
  const cues = [];
  const card = (html) =>
    page.evaluate((h) => {
      const k = document.getElementById('hx-card');
      if (h != null) k.innerHTML = h;
      k.classList.toggle('on', h != null);
    }, html);
  const caption = (num, text) =>
    page.evaluate(([nn, tt]) => {
      const c = document.getElementById('hx-cap');
      if (!tt) return c.classList.remove('on');
      c.querySelector('.n').textContent = nn;
      c.querySelector('.t').textContent = tt;
      c.classList.add('on');
    }, [num, text]);
  /**
   * Shows the next caption and starts its narration clip. The screen waits for the narration,
   * unless `overlap` is set: then the following actions play while the narrator describes them.
   */
  const say = async (ms = 2600, { overlap = false, noCaption = false } = {}) => {
    n++;
    const wait = talkingUntil - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    if (!noCaption) await caption(`${n - 1} / ${CAPTIONS.length - 2}`, CAPTIONS[n - 1]);
    // frame timestamps are wall-clock capture times, so the caption is on screen from about now
    const at = Date.now() / 1000 + 0.03;
    const dur = clipSeconds(n);
    if (dur) {
      cues.push({ n, file: clip(n), at });
      talkingUntil = Date.now() + (dur + 0.6) * 1000;
      if (!overlap) ms = Math.max(ms, (dur + 0.8) * 1000);
    } else {
      cues.push({ n, file: null, at });
    }
    if (SHOTS) await page.waitForTimeout(500).then(() => page.screenshot({ path: join(SHOTS, `step-${String(n).padStart(2, '0')}.png`) }));
    await page.waitForTimeout(ms);
  };
  /** Waits until the narration has finished (plus `extra` ms; negative = that much before its end). */
  const waitTalk = async (extra = 0) => {
    const w = talkingUntil + extra - Date.now();
    if (w > 0) await page.waitForTimeout(w);
  };
  const tap = async (loc, pause = 800) => {
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const b = await loc.boundingBox();
    if (b) {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
      await page.evaluate(([x, y]) => {
        const d = document.createElement('div');
        d.className = 'hx-tap';
        d.style.left = x + 'px';
        d.style.top = y + 'px';
        document.body.appendChild(d);
        setTimeout(() => { d.style.transform = 'scale(1.6)'; d.style.opacity = '0'; }, 280);
        setTimeout(() => d.remove(), 900);
      }, [b.x + b.width / 2, b.y + b.height / 2]);
    }
    await page.waitForTimeout(380);
    await loc.click();
    await page.waitForTimeout(pause);
  };
  const type = async (loc, text, delay = 75) => {
    await tap(loc, 200);
    await loc.fill('');
    await loc.pressSequentially(text, { delay });
    await page.waitForTimeout(450);
  };
  const scroll = async (px, ms = 1400) => {
    await page.mouse.move(520, 400);
    const steps = Math.max(1, Math.round(Math.abs(px) / 120));
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, px / steps);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(ms);
  };
  /** Draws a yellow ring around what the narrator talks about (the screencast shows no mouse pointer). */
  const point = async (loc, ms = 2000) => {
    const el = loc.first();
    if (!(await el.count())) return page.waitForTimeout(ms);
    await el.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await page.waitForTimeout(600);
    const b = await el.boundingBox();
    if (b) {
      await page.evaluate(([x, y, w, h, t]) => {
        const d = document.createElement('div');
        d.className = 'hx-ring';
        Object.assign(d.style, { left: x - 6 + 'px', top: y - 6 + 'px', width: w + 12 + 'px', height: h + 12 + 'px' });
        document.body.appendChild(d);
        requestAnimationFrame(() => d.classList.add('on'));
        setTimeout(() => d.classList.remove('on'), t - 350);
        setTimeout(() => d.remove(), t);
      }, [b.x, b.y, b.width, b.height, ms]);
    }
    await page.waitForTimeout(ms);
  };
  const toTop = async () => {
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await page.waitForTimeout(300);
  };
  const side = (href) => page.locator(`aside.side a[href="#${href}"]`);

  // 1. Title card
  await card(
    EN
      ? `<div class="k">Quantum Synergy Solutions</div><h1>Shop ERP</h1><h2>How to use it</h2><p>Your shop's accounts on the computer: stock, purchases, sales, ledger and day-end closing</p><div class="f">Demo with made-up shop data</div>`
      : `<div class="k">Quantum Synergy Solutions</div><h1>Shop ERP</h1><h2>استعمال کا طریقہ</h2><p>کمپیوٹر پر دکان کا حساب کتاب: اسٹاک، خرید، فروخت، کھاتہ اور ڈے کلوزنگ</p><div class="f">Demo with made-up shop data</div>`,
  );
  await page.waitForTimeout(1200);
  await say(4500, { noCaption: true });
  await card(null);
  await page.waitForTimeout(900);

  // 2. First-time setup
  await say(1500, { overlap: true });
  await type(page.locator('#setup-shopName'), SHOP, 65);
  await type(page.locator('#setup-ownerName'), OWNER.name);
  await type(page.locator('#setup-phone'), OWNER.phone);
  await type(page.locator('#setup-password'), OWNER.password, 45);
  await type(page.locator('#setup-password2'), OWNER.password, 45);
  await waitTalk(300);
  await tap(page.getByRole('button', { name: UI.setupGo }), 400);
  await page.locator('aside.side').waitFor({ timeout: 20000 });
  // the video's sample products and parties (as if typed in earlier), then the home screen again
  await seedThroughApi();
  await page.reload();
  await page.locator('a.bigbtn.in').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);

  // 3. Home
  await say(1000, { overlap: true });
  await point(page.locator('main.body > .card').first(), 3600);
  await point(page.locator('main.body > a.card.row'), 2400);
  await point(page.locator('.lines.actions'), 2600);
  await point(page.locator('aside.side nav'), 2600);
  await scroll(400, 1800);
  await scroll(-400, 600);
  await waitTalk(400);

  // 4. Inventory: a new product
  await tap(side('/stock'), 1500);
  await say(2000, { overlap: true });
  await scroll(300, 1500);
  await scroll(-300, 500);
  await tap(page.locator('.chips button', { hasText: UI.newProduct }), 1200);
  const fld = (label) => page.locator('label.f', { has: page.locator('span', { hasText: new RegExp(`^${label}$`) }) }).locator('input, select');
  await type(fld(UI.name), 'Dinner Set 24 pcs', 60);
  await tap(fld(UI.category), 200);
  await fld(UI.category).selectOption({ label: 'Crockery' });
  await page.waitForTimeout(500);
  await type(fld(UI.purchasePrice), '7500');
  await type(fld(UI.salePrice), '9500');
  await type(fld(UI.minLevel), '2');
  await waitTalk(200);
  await tap(page.getByRole('button', { name: UI.save, exact: true }), 1800);

  // 5. Purchase by photo
  await tap(side('/scan/new?type=PURCHASE'), 1200);
  await say(1800, { overlap: true });
  await page.locator('input[type=file]').setInputFiles(join(api, 'demo-fixtures/purchase-bill.png'));
  await page.waitForTimeout(2200);
  await waitTalk(0);
  await tap(page.getByRole('button', { name: UI.upload }), 600);
  await page.getByText(UI.review).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);

  // 6. Review: warnings and photo crops
  await say(1200, { overlap: true });
  await point(page.locator('.banner').first(), 2500);
  await point(page.locator('.banner.bad'), 2500);
  await scroll(330, 2000);
  await point(page.locator('.ln .crop').first(), 2500);
  await waitTalk(300);

  // 7. Add the missing row 5 with the product made in step 4
  await say(1500, { overlap: true });
  await tap(page.getByRole('button', { name: UI.addLine }), 1000);
  await type(page.locator('.sheet').getByLabel(UI.written), 'Dinner set 24pc', 60);
  await type(page.locator('.sheet').getByPlaceholder(UI.searchProduct), 'dinner', 90);
  await page.waitForTimeout(1200);
  await tap(page.locator('.sheet .list button.item', { hasText: 'Dinner Set 24 pcs' }), 900);
  await type(page.locator('.sheet').getByLabel(UI.qty), '6');
  await type(page.locator('.sheet').getByLabel(UI.rate), '7500');
  await page.waitForTimeout(600);
  await tap(page.locator('.sheet').getByRole('button', { name: UI.ok }), 1600);
  await waitTalk(300);

  // 8. Totals match, supplier, save -> stock up
  await scroll(900, 1200);
  await say(900, { overlap: true });
  await point(page.locator('.card.total'), 2200);
  await toTop();
  await point(page.locator('button.card.row').first(), 2200);
  await waitTalk(200);
  await tap(page.getByRole('button', { name: UI.confirmIn }), 2200);
  await page.getByText(UI.doneIn).waitFor();
  await page.waitForTimeout(1500);
  await scroll(350, 2200);
  await scroll(-350, 600);

  // 9. Sale by photo: short stock blocks the sale
  await tap(side('/scan/new?type=SALE'), 1000);
  await page.locator('input[type=file]').setInputFiles(join(api, 'demo-fixtures/sale-bill.png'));
  await page.waitForTimeout(1600);
  await tap(page.getByRole('button', { name: UI.upload }), 600);
  await page.getByText(UI.review).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  await scroll(330, 1000);
  await say(2500, { overlap: true });
  await point(page.locator('.ln.stop'), 3000);
  await waitTalk(-1500);
  await tap(page.locator('.ln', { hasText: 'Tee Joint' }), 900);
  await type(page.locator('.sheet').getByLabel(UI.qty), '45');
  await tap(page.locator('.sheet').getByRole('button', { name: UI.ok }), 1500);
  await waitTalk(300);

  // 10. Customer from the photo, part cash, rest udhaar
  await toTop();
  await say(1800, { overlap: true });
  await point(page.locator('button.card.row').first(), 2200);
  await scroll(1400, 1000);
  await type(page.getByLabel(UI.received), '30000', 120);
  await point(page.locator('.banner.warn').last(), 2000);
  await waitTalk(200);
  await tap(page.getByRole('button', { name: UI.confirmOut }), 2200);
  await page.getByText(UI.doneOut).waitFor();
  await page.waitForTimeout(1200);

  // 11. Receipt
  await say(3000, { overlap: true });
  await scroll(450, 2000);
  await page.locator('.receipt-frame').scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await point(page.locator('button.cta.wa'), 1800);
  await point(page.locator('button.cta.sec', { hasText: UI.print }), 1800);
  await waitTalk(400);

  // 12. Ledger: wasooli
  await tap(side('/ledger'), 1500);
  await say(2000, { overlap: true });
  await point(page.locator('a.item', { hasText: 'Rana Builders' }), 1800);
  await tap(page.locator('a.item', { hasText: 'Rana Builders' }), 1500);
  await tap(page.getByRole('button', { name: UI.recordPayment }), 900);
  await type(page.locator('.sheet input.cashin'), '10000', 120);
  await page.waitForTimeout(500);
  await tap(page.locator('.sheet').getByRole('button', { name: UI.save, exact: true }), 1800);
  await waitTalk(800);

  // 13. Day-end: starting cash and an expense
  await tap(side('/day'), 1600);
  await say(2000, { overlap: true });
  await scroll(250, 1200);
  await tap(page.getByRole('button', { name: `+ ${UI.addExp}` }), 900);
  await tap(page.locator('.sheet .chips button', { hasText: 'Tea / food' }), 400);
  await type(page.locator('.sheet input.cashin'), '450', 120);
  await tap(page.locator('.sheet').getByRole('button', { name: UI.addExp, exact: true }), 1500);
  await tap(page.getByRole('button', { name: UI.setStart, exact: true }), 900);
  const startCard = page.locator('.card', { has: page.locator('label.f', { hasText: UI.startQ }) }).last();
  await type(startCard.locator('input'), '5000', 120);
  await tap(startCard.getByRole('button', { name: UI.save, exact: true }), 1400);
  await waitTalk(300);

  // 14. Count the galla and close the day
  await scroll(900, 1000);
  const expected = await page.evaluate((label) => {
    const row = [...document.querySelectorAll('.rw.tot')].find((r) => r.textContent.includes(label));
    return Number(row.querySelector('.n').textContent.replace(/[^0-9.]/g, ''));
  }, UI.expected);
  await say(2000, { overlap: true });
  await point(page.locator('.rw.tot', { hasText: UI.expected }), 1800);
  await type(page.locator('#counted'), String(expected), 120);
  await page.waitForTimeout(1800);
  await waitTalk(-800);
  await tap(page.getByRole('button', { name: UI.closeBtn }), 2400);
  await waitTalk(500);

  // 15. More: data safety and AI settings
  await tap(side('/more'), 1500);
  await say(2500, { overlap: true });
  const safety = page.locator('.card', { has: page.locator('h2', { hasText: UI.dataSafety }) });
  await safety.scrollIntoViewIfNeeded();
  await point(safety, 3500);
  await tap(page.locator('a.item[href="#/ai"]'), 1800);
  await page.mouse.move(600, 300, { steps: 8 });
  await page.waitForTimeout(2000);
  await scroll(350, 2200);
  await waitTalk(500);

  // 16. Closing card
  await caption('', null);
  await card(`<div class="k">Shop ERP</div><h2>${EN ? 'Thank you' : 'شکریہ'}</h2><p>${EN ? 'For help or questions, contact us' : 'مدد یا سوال کے لیے رابطہ کریں'}</p><h1 style="font-size:40px">Quantum Synergy Solutions</h1><div class="f">Demo with made-up shop data · AI reading needs an AI key</div>`);
  await page.waitForTimeout(900);
  await say(4500, { noCaption: true });
  await waitTalk(1500);

  await cdp.send('Page.stopScreencast');
  const end = Date.now() / 1000;
  await context.close();
  await browser.close();
  const fwd = (p) => p.split('\\').join('/');
  // Constant 25 fps: output frame k (time k/25) shows the newest frame captured by then. Durations
  // are whole multiples of 0.04 s, so the picture cannot drift away from the narration (summing the
  // raw, rounded gaps between screencast frames let it run up to a second late by the end).
  const FPS = 25;
  const t0 = frames[0].t;
  const total = Math.ceil((end - t0) * FPS);
  const list = [];
  let j = 0;
  let cur = 0;
  let run = 0;
  for (let k = 0; k < total; k++) {
    while (j + 1 < frames.length && frames[j + 1].t <= t0 + k / FPS) j++;
    if (j !== cur && run) {
      list.push(`file '${fwd(frames[cur].file)}'\nduration ${(run / FPS).toFixed(2)}`);
      run = 0;
    }
    cur = j;
    run++;
  }
  list.push(`file '${fwd(frames[cur].file)}'\nduration ${(run / FPS).toFixed(2)}`);
  list.push(`file '${fwd(frames[cur].file)}'`);
  const listFile = join(framesDir, 'list.txt');
  writeFileSync(listFile, list.join('\n') + '\n');
  const start = frames[0].t;
  console.log(`${frames.length} frames, ${(end - start).toFixed(1)} s, ${cues.filter((c) => c.file).length} narration clips, expected cash ${expected}`);
  if (errors.length) console.log('page errors:', errors);
  writeFileSync(join(tmpBase, 'cues.json'), JSON.stringify(cues.map((c) => ({ n: c.n, at: +(c.at - start).toFixed(2) })), null, 1));
  return { listFile, cues: cues.filter((c) => c.file), start, length: end - start };
}

await prepareDatabase();
const server = await startServer();
let rec;
try {
  rec = await record();
} catch (e) {
  // leave a picture of the screen where the recording stopped
  await dbgPage?.screenshot({ path: join(tmpBase, 'failed.png') }).catch(() => {});
  console.log('screen at failure:', join(tmpBase, 'failed.png'), 'page errors:', errors);
  throw e;
} finally {
  server.kill();
}

// Narration at the caption times; music bed under it, ducked by the voice (sidechain compressor).
const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', rec.listFile];
for (const c of rec.cues) args.push('-i', c.file);
const music = existsSync(musicFile);
if (music) args.push('-stream_loop', '-1', '-i', musicFile);
const filters = [];
if (rec.cues.length) {
  rec.cues.forEach((c, i) => {
    const ms = Math.max(0, Math.round((c.at - rec.start) * 1000));
    filters.push(`[${i + 1}:a]aresample=44100,aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,adelay=${ms}|${ms}[a${i}]`);
  });
  filters.push(`${rec.cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${rec.cues.length}:normalize=0:duration=longest,apad[vmix]`);
  filters.push('[vmix]asplit=2[voice][key]');
}
let outLabel = '[voice]';
if (music) {
  const L = rec.length.toFixed(2);
  const fadeOut = (rec.length - 4).toFixed(2);
  const m = rec.cues.length + 1;
  // voice clips normalised to -16 LUFS; music bed (file about -18 LUFS) lowered to about -26 LUFS,
  // and about 6 dB more while the voice speaks (sidechain compressor keyed by the voice)
  filters.push(`[${m}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${L},volume=-8.5dB,afade=t=in:st=0:d=3,afade=t=out:st=${fadeOut}:d=4[bed]`);
  if (rec.cues.length) {
    filters.push('[bed][key]sidechaincompress=threshold=0.05:ratio=3:attack=50:release=800:makeup=1[duck]');
    filters.push('[voice][duck]amix=inputs=2:normalize=0:duration=first,atrim=0:' + L + ',alimiter=limit=0.95[aout]');
  } else filters.push('[bed]anull[aout]');
  outLabel = '[aout]';
} else if (rec.cues.length) {
  filters.push(`[voice]atrim=0:${rec.length.toFixed(2)}[aout]`);
  outLabel = '[aout]';
  filters.push('[key]anullsink');
}
if (filters.length) args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', outLabel, '-c:a', 'aac', '-b:a', '160k', '-ar', '44100');
args.push('-vf', 'fps=25,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', '-shortest', OUT);
execFileSync('ffmpeg', args, { stdio: 'inherit' });
rmSync(join(tmpBase, 'frames'), { recursive: true, force: true });
console.log(existsSync(OUT) ? `video: ${OUT}` : 'MP4 not created');
