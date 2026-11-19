// Vercel build: API + domain, the web app built for /app/, then vercel-out/ with the product
// website at / and the web app at /app/ (Vercel's static output). Works on Linux and Windows.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });

run('npm run db:generate --workspace @erp/api');
run('npm run build');
run('npm run build --workspace @erp/web', { WEB_BASE: '/app/' });

const out = 'vercel-out';
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
if (existsSync('apps/site/index.html')) cpSync('apps/site', out, { recursive: true });
cpSync('apps/web/dist', `${out}/app`, { recursive: true });
console.log('vercel-out ready: website at /, app at /app/');
