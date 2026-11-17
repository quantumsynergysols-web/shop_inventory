// Prepares the integration-test database (shop_erp_test) and runs the DB tests against it.
// Usage: npm run test:db --workspace @erp/api
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, '..');
const base = process.env.DATABASE_URL;
if (!base) throw new Error('DATABASE_URL missing (run through npm so .env is loaded)');
const url = new URL(base);
const testDb = url.pathname.slice(1) + '_test';
const testUrl = new URL(base);
testUrl.pathname = '/' + testDb;

const admin = new URL(base);
admin.pathname = '/postgres';
const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
const exists = await db.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = '${testDb.replace(/'/g, "''")}'`);
if (exists.length === 0) {
  await db.$executeRawUnsafe(`CREATE DATABASE "${testDb}"`);
  console.log(`created ${testDb}`);
}
await db.$disconnect();

const env = { ...process.env, DATABASE_URL: testUrl.toString(), TEST_DATABASE_URL: testUrl.toString() };
execFileSync(process.execPath, [join(api, '../../node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(api, 'prisma/schema.prisma')], { env, stdio: 'inherit', cwd: api });
execFileSync(process.execPath, ['--test', '--test-concurrency=1', '--enable-source-maps', 'dist/**/*.db.test.js'], { env, stdio: 'inherit', cwd: api });
