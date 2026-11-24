// Builds the Windows installer: apps/desktop/dist/Shop ERP Setup <version>.exe
//   npm run installer --workspace @erp/desktop
// 1. builds the domain, API and web app;
// 2. assembles apps/desktop/build/app with only what the installed app needs (compiled code, database
//    migrations, production node_modules, PostgreSQL with pg_dump/pg_restore for backups, the icon);
// 3. runs electron-builder (NSIS installer, per-user, Windows 10/11 x64).
import { execSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '../..');
const stage = path.join(desktop, 'build', 'app');
const require = createRequire(path.join(root, 'package.json'));
const run = (cmd, cwd = root, env = {}) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
};
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

// 1. build
try {
  run('npm run db:generate --workspace @erp/api');
} catch (e) {
  // A running dev copy of the app keeps the engine file open; the client generated before is fine to build with
  if (!existsSync(path.join(root, 'node_modules/.prisma/client/index.d.ts'))) throw e;
  console.warn('! prisma generate skipped (engine file in use, probably by a running dev app); using the existing client');
}
run('npm run build');
run('npm run build --workspace @erp/web', root, { WEB_BASE: '/' });

// 2. assemble
rmSync(path.join(desktop, 'build'), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const api = json(path.join(root, 'apps/api/package.json'));
const desk = json(path.join(desktop, 'package.json'));
const { '@erp/domain': _domain, '@vercel/blob': _blob, '@vercel/functions': _fns, ...apiDeps } = api.dependencies;
writeFileSync(
  path.join(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'shop-erp',
      productName: 'Shop ERP',
      version: desk.version,
      description: desk.description,
      author: 'Quantum Synergy Solutions',
      private: true,
      type: 'module',
      main: 'main.js',
      dependencies: { ...apiDeps, '@vercel/blob': _blob, '@vercel/functions': _fns, prisma: api.devDependencies.prisma, 'embedded-postgres': desk.dependencies['embedded-postgres'] },
      allowScripts: { 'prisma@6.1.0': true, '@prisma/client@6.1.0': true, '@prisma/engines@6.1.0': true },
    },
    null,
    2,
  ),
);
copyFileSync(path.join(desktop, 'src/main.js'), path.join(stage, 'main.js'));
const server = path.join(stage, 'server');
for (const [from, to] of [
  ['apps/api/dist', 'apps/api/dist'],
  ['apps/api/prisma/schema.prisma', 'apps/api/prisma/schema.prisma'],
  ['apps/api/prisma/migrations', 'apps/api/prisma/migrations'],
  ['apps/api/demo-fixtures', 'apps/api/demo-fixtures'],
  ['apps/api/package.json', 'apps/api/package.json'],
  ['apps/web/dist', 'apps/web/dist'],
])
  cpSync(path.join(root, from), path.join(server, to), { recursive: true, filter: (p) => !p.endsWith('.map') && !/\.test\.js$/.test(p) && !p.includes(`${path.sep}test-support`) });

console.log('> npm install --omit=dev (production modules only)');
run('npm install --omit=dev --no-audit --no-fund --prefer-offline --install-links=false', stage);
// the shared business rules package
const domainDest = path.join(stage, 'node_modules/@erp/domain');
mkdirSync(domainDest, { recursive: true });
cpSync(path.join(root, 'packages/domain/dist'), path.join(domainDest, 'dist'), { recursive: true, filter: (p) => !p.endsWith('.map') });
copyFileSync(path.join(root, 'packages/domain/package.json'), path.join(domainDest, 'package.json'));
// electron-builder packs only listed dependencies: list it now that it is in node_modules (npm install ran without it)
const stagePkg = json(path.join(stage, 'package.json'));
stagePkg.dependencies['@erp/domain'] = json(path.join(root, 'packages/domain/package.json')).version;
writeFileSync(path.join(stage, 'package.json'), JSON.stringify(stagePkg, null, 2));
// database client for this schema
run(`node node_modules/prisma/build/index.js generate --schema server/apps/api/prisma/schema.prisma`, stage);
// pg_dump / pg_restore for the daily backup (same PostgreSQL 18 family as the bundled server)
const pgBin = path.join(stage, 'node_modules/@embedded-postgres/windows-x64/native/bin');
const pgSource = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\18\\bin';
for (const exe of ['pg_dump.exe', 'pg_restore.exe']) {
  if (!existsSync(path.join(pgSource, exe))) throw new Error(`${exe} not found in ${pgSource} (set PG_BIN to a PostgreSQL 18 bin folder)`);
  copyFileSync(path.join(pgSource, exe), path.join(pgBin, exe));
}
// app icon from the web app's icon
const sharp = require('sharp');
await sharp(path.join(root, 'apps/web/public/icon.svg'), { density: 512 }).resize(512, 512).png().toFile(path.join(desktop, 'build/icon.png'));

// 3. installer
rmSync(path.join(desktop, 'dist'), { recursive: true, force: true });
run(`npx electron-builder --win nsis --x64 --config electron-builder.json --publish never`, desktop);

// 4. self-check: load the packaged server's code with the packaged Electron, so a missing module
//    fails the build here instead of on the client's PC
const unpacked = path.join(desktop, 'dist', 'win-unpacked');
const appJs = path.join(unpacked, 'resources', 'app', 'server', 'apps', 'api', 'dist', 'app.js');
const check = `import(${JSON.stringify(new URL(`file:///${appJs.replace(/\\/g, '/')}`).href)}).then(m => { if (typeof m.createApp !== 'function') throw new Error('createApp missing'); return import('@prisma/client'); }).then(p => { if (!p.Prisma || !p.PrismaClient) throw new Error('prisma client missing'); console.log('packaged server loads: OK'); }).catch(e => { console.error('PACKAGED SERVER BROKEN:', e.message); process.exit(1); })`;
execSync(`"${path.join(unpacked, 'Shop ERP.exe')}" --input-type=module -e ${JSON.stringify(check)}`, { cwd: path.join(unpacked, 'resources', 'app'), stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
console.log(`\nInstaller: ${path.join(desktop, 'dist')}`);
