// Shop ERP for Windows: starts its own PostgreSQL, applies database updates, runs the app's server
// and shows it in a window. All data stays on this PC under %APPDATA%\Shop ERP. Phones on the same
// Wi-Fi can open the address shown under Help > Connect a phone to photograph bills.
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT = 'Shop ERP';

// In the installed app the server sits in <app>/server; in development it is the repository root.
const serverRoot = app.isPackaged ? path.join(app.getAppPath(), 'server') : path.resolve(here, '../../..');
const apiDir = path.join(serverRoot, 'apps', 'api');
const webDist = path.join(serverRoot, 'apps', 'web', 'dist');
// The package only exports dist/index.js; its PostgreSQL programs are in native/bin next to it
const pgBin = path.join(path.dirname(require.resolve('@embedded-postgres/windows-x64')), '..', 'native', 'bin');
const prismaCli = require.resolve('prisma/build/index.js');

// The data folder follows the app name: %APPDATA%\Shop ERP (installed) or \Shop ERP Dev (development)
app.setName(app.isPackaged ? PRODUCT : `${PRODUCT} Dev`);
const data = app.getPath('userData');
const dirs = { pg: path.join(data, 'database'), storage: path.join(data, 'photos'), backups: path.join(data, 'backups'), logs: path.join(data, 'logs') };
const logFile = path.join(dirs.logs, 'app.log');
const log = (msg) => {
  try {
    appendFileSync(logFile, `${new Date().toISOString()} ${String(msg).replace(/postgres(ql)?:\/\/\S+/g, '<db-url>')}\n`);
  } catch {
    /* logging must never stop the app */
  }
};

let pg = null;
let server = null;
let win = null;
let splash = null;
let apiPort = 0;
let quitting = false;

/** Secrets made once on first run and kept in this Windows user's AppData. */
function loadConfig() {
  const file = path.join(data, 'config.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const hex = (n) => randomBytes(n).toString('hex');
  const cfg = { pgSuperPassword: hex(24), appDbPassword: hex(24), jwtSecret: randomBytes(48).toString('base64url'), aiKeySecret: randomBytes(48).toString('base64url'), createdAt: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return cfg;
}

const isFree = (port, host) =>
  new Promise((resolve) => {
    const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
async function freePort(preferred, host, tries = 20) {
  for (let p = preferred; p < preferred + tries; p++) if (await isFree(p, host)) return p;
  return 0;
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = '';
    p.stdout?.on('data', (d) => (out += d));
    p.stderr?.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} exited with ${code}: ${out.slice(-800)}`))));
  });
}

/** Starts PostgreSQL (creating it on first run) and returns the app's connection URL. */
async function startDatabase(cfg) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const port = await freePort(54329, '127.0.0.1');
  if (!port) throw new Error('No free port for the database');
  const fresh = !existsSync(path.join(dirs.pg, 'PG_VERSION'));
  pg = new EmbeddedPostgres({
    databaseDir: dirs.pg,
    user: 'postgres',
    password: cfg.pgSuperPassword,
    port,
    persistent: true,
    authMethod: 'scram-sha-256',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // UTC like the cloud database; the app itself decides the business day (Pakistan time)
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'timezone=UTC'],
    onLog: (m) => log(`[db] ${m}`),
    onError: (m) => log(`[db error] ${m}`),
  });
  if (fresh) {
    log('creating the database');
    await pg.initialise();
  }
  await pg.start();
  const su = pg.getPgClient('postgres', '127.0.0.1');
  await su.connect();
  try {
    const db = await su.query(`SELECT 1 FROM pg_database WHERE datname = 'shop_erp'`);
    if (!db.rowCount) await su.query('CREATE DATABASE shop_erp');
    const role = await su.query(`SELECT 1 FROM pg_roles WHERE rolname = 'erp_app'`);
    // NFR-SEC-02: the app's own role cannot bypass row-level security
    const pw = cfg.appDbPassword.replace(/'/g, "''");
    await su.query(`${role.rowCount ? 'ALTER' : 'CREATE'} ROLE erp_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${pw}'`);
  } finally {
    await su.end();
  }
  const superUrl = `postgresql://postgres:${encodeURIComponent(cfg.pgSuperPassword)}@127.0.0.1:${port}/shop_erp`;
  const appUrl = `postgresql://erp_app:${encodeURIComponent(cfg.appDbPassword)}@127.0.0.1:${port}/shop_erp`;
  return { port, superUrl, appUrl };
}

/** Applies database updates shipped with this version, then gives the app role its rights. */
async function migrate(db) {
  log('applying database updates');
  const out = await run(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', path.join(apiDir, 'prisma', 'schema.prisma')], {
    cwd: apiDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DATABASE_URL: db.superUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
  log(out.split('\n').filter((l) => /migration|applied|No pending/i.test(l)).join(' | '));
  log('granting the app role its rights');
  const su = pg.getPgClient('shop_erp', '127.0.0.1');
  await su.connect();
  try {
    for (const sql of [
      'GRANT CONNECT ON DATABASE shop_erp TO erp_app',
      'GRANT USAGE ON SCHEMA public TO erp_app',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app',
      'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO erp_app',
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app',
    ])
      await su.query(sql);
  } finally {
    await su.end();
  }
}

/** Runs the API (which also serves the web app) as a Node process inside Electron. */
async function startServer(db, cfg) {
  log('starting the app server');
  apiPort = await freePort(3000, '0.0.0.0');
  log(`app port ${apiPort}`);
  if (!apiPort) throw new Error('No free port for the app (3000-3019 are all in use)');
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    DATABASE_URL: db.appUrl,
    JWT_SECRET: cfg.jwtSecret,
    AI_KEY_SECRET: cfg.aiKeySecret,
    PORT: String(apiPort),
    HOST: '0.0.0.0', // phones on the shop's Wi-Fi
    WEB_DIST: webDist,
    STORAGE_DIR: dirs.storage,
    BACKUP_DIR: dirs.backups,
    BACKUP_ENABLED: 'true',
    PG_DUMP: path.join(pgBin, 'pg_dump.exe'),
    DEMO_FIXTURES_DIR: path.join(apiDir, 'demo-fixtures'),
    SETUP_ENABLED: 'true',
  };
  // A shop's own AI key can be set in the app; a QSSols hosted key can be put in ai.env next to config.json
  const aiEnv = path.join(data, 'ai.env');
  if (existsSync(aiEnv))
    for (const line of readFileSync(aiEnv, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
      if (m && /^(HOSTED_AI_PROVIDER|OPENAI_API_KEY|GEMINI_API_KEY|OPENAI_MODEL|GEMINI_MODEL|HOSTED_MONTHLY_SCANS)$/.test(m[1])) env[m[1]] = m[2];
    }
  server = spawn(process.execPath, [path.join(apiDir, 'dist', 'main.js')], { cwd: apiDir, env, windowsHide: true });
  log('app server process started');
  server.stdout.on('data', (d) => log(`[app] ${d.toString().trim()}`));
  server.stderr.on('data', (d) => log(`[app error] ${d.toString().trim()}`));
  server.on('exit', (code) => {
    log(`app server stopped (${code})`);
    server = null;
    if (!quitting) {
      dialog.showErrorBox(PRODUCT, `The app's server stopped unexpectedly. Please restart ${PRODUCT}.\n\nDetails are in ${logFile}`);
      app.quit();
    }
  });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
      if (r.ok && (await r.json()).db === 'up') return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The app did not start within 60 seconds');
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a.address}:${apiPort}/`);
}

function buildMenu() {
  const template = [
    { label: 'File', submenu: [{ label: 'Open backups folder', click: () => shell.openPath(dirs.backups) }, { label: 'Open photos folder', click: () => shell.openPath(dirs.storage) }, { type: 'separator' }, { role: 'quit', label: `Quit ${PRODUCT}` }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Connect a phone…',
          click: () => {
            const urls = lanAddresses();
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'Connect a phone',
              message: urls.length ? 'On a phone connected to the same Wi-Fi, open:' : 'This PC is not connected to a network.',
              detail: urls.length ? `${urls.join('\n')}\n\nThen log in as usual. If the page does not open, allow ${PRODUCT} through Windows Firewall (private networks).` : 'Connect the PC to the shop Wi-Fi to use phones.',
            });
          },
        },
        { label: 'Open data folder', click: () => shell.openPath(data) },
        { label: 'Open log file', click: () => shell.openPath(logFile) },
        { type: 'separator' },
        { label: `About ${PRODUCT}`, click: () => dialog.showMessageBox(win, { type: 'info', title: PRODUCT, message: `${PRODUCT} ${app.getVersion()}`, detail: `Quantum Synergy Solutions\nData folder: ${data}` }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showSplash() {
  splash = new BrowserWindow({ width: 420, height: 260, frame: false, resizable: false, show: true, backgroundColor: '#070b1f', webPreferences: { sandbox: true } });
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(120% 90% at 10% 0%,#16205a,#070b1f 60%);color:#eef1ff;font-family:Segoe UI,system-ui,sans-serif">
  <div style="text-align:center"><div style="width:54px;height:54px;margin:0 auto 14px;border-radius:16px;background:linear-gradient(135deg,#4f6bff,#8b5cf6);box-shadow:0 10px 30px rgba(79,107,255,.5)"></div>
  <div style="font-size:20px;font-weight:700">${PRODUCT}</div><div style="margin-top:8px;color:#aab3d6;font-size:13px">Starting… / شروع ہو رہا ہے…</div></div></body>`;
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

async function start() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  log(`starting ${PRODUCT} ${app.getVersion()}`);
  showSplash();
  try {
    const cfg = loadConfig();
    const db = await startDatabase(cfg);
    await migrate(db);
    await startServer(db, cfg);
  } catch (e) {
    log(`start failed: ${e?.stack ?? e}`);
    splash?.destroy();
    dialog.showErrorBox(PRODUCT, `${PRODUCT} could not start.\n\n${String(e?.message ?? e).slice(0, 500)}\n\nDetails are in ${logFile}`);
    await shutdown();
    app.exit(1);
    return;
  }
  buildMenu();
  win = new BrowserWindow({ width: 1280, height: 840, minWidth: 380, minHeight: 600, show: false, title: PRODUCT, backgroundColor: '#070b1f', webPreferences: { sandbox: true, contextIsolation: true } });
  // Links to other sites (WhatsApp, website) open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(`http://127.0.0.1:${apiPort}`)) shell.openExternal(url);
    return { action: url.startsWith(`http://127.0.0.1:${apiPort}`) ? 'allow' : 'deny' };
  });
  // Windows shutting down or logging off with the app open: stop the database cleanly right away
  win.on('session-end', () => {
    quitting = true;
    server?.kill();
    stopDatabaseCleanly();
  });
  win.once('ready-to-show', () => {
    splash?.destroy();
    splash = null;
    win.show();
  });
  await win.loadURL(`http://127.0.0.1:${apiPort}/`);
}

/**
 * Clean database shutdown with PostgreSQL's own pg_ctl (writes everything to disk and removes the
 * lock). The bundled package's stop() ends the process abruptly on Windows, which PostgreSQL
 * survives with crash recovery, but shop data deserves a clean stop every time.
 */
function stopDatabaseCleanly() {
  if (!existsSync(path.join(dirs.pg, 'postmaster.pid'))) return;
  try {
    execFileSync(path.join(pgBin, 'pg_ctl.exe'), ['stop', '-D', dirs.pg, '-m', 'fast', '-w', '-t', '30'], { windowsHide: true, stdio: 'ignore' });
    log('database stopped cleanly');
  } catch (e) {
    log(`database clean stop failed: ${e?.message ?? e}`);
  }
}

async function shutdown() {
  quitting = true;
  if (server) {
    server.kill();
    server = null;
  }
  if (pg) {
    stopDatabaseCleanly();
    try {
      await pg.stop(); // nothing left to stop normally; releases the package's handles
    } catch {
      /* already stopped */
    }
    pg = null;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
  let stopped = false;
  app.on('before-quit', (e) => {
    if (stopped) return;
    e.preventDefault();
    shutdown().finally(() => {
      stopped = true;
      app.quit();
    });
  });
}
