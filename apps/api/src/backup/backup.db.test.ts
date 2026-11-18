/**
 * FR-SET-05: full export (Excel + photos zip) and the daily database backup, against PostgreSQL.
 * Run with: npm run test:db --workspace @erp/api
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PrismaClient } from '@prisma/client';
import { client, makeShop, resetDb, startApp, testConfig } from '../test-support/db-app.js';
import { BackupService, msUntilHour } from './backup.service.js';

const url = process.env.TEST_DATABASE_URL;
const photo = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(1500)]);

test('next backup time is the coming 2 am in Pakistan', () => {
  // 18 Nov 2026 20:00 UTC = 19 Nov 01:00 PKT → 1 hour to 02:00 PKT
  assert.equal(msUntilHour(2, new Date('2026-11-18T20:00:00Z')), 3600_000);
  // 21:00 UTC = 02:00 PKT exactly → the next day
  assert.equal(msUntilHour(2, new Date('2026-11-18T21:00:00Z')), 24 * 3600_000);
});

describe('export and backup against PostgreSQL', { skip: !url && 'TEST_DATABASE_URL not set (run npm run test:db)' }, () => {
  let app: INestApplication;
  let db: PrismaClient;
  let api: ReturnType<typeof client>;
  const id: Record<string, string> = {};

  before(async () => {
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    await resetDb(db);
    const a = await makeShop(db, 'Haji Sanitary', '0360');
    const b = await makeShop(db, 'Other Shop', '0370');
    id.shop = a.shop.id;
    ({ app } = await startApp(url!));
    api = client(`http://127.0.0.1:${app.getHttpServer().address().port}/api`);
    for (const [k, phone] of [['owner', a.phones.OWNER], ['acct', a.phones.ACCOUNTANT], ['other', b.phones.OWNER]] as const) await api.login(k, phone!);
    const { call } = api;
    const pipe = (await call('POST', '/products', 'owner', { name: 'PVC Pipe 1 inch', purchasePricePaisa: 45000, salePricePaisa: 65000 })).json.id;
    await call('POST', '/products', 'other', { name: 'Secret Other Product', purchasePricePaisa: 100 });
    await call('POST', '/documents', 'owner', { kind: 'SALE', lines: [{ productId: pipe, qtyMilli: 0, ratePaisa: 65000 }] });
    const sup = (await call('POST', '/parties', 'owner', { name: 'Al-Madina', type: 'SUPPLIER' })).json.id;
    assert.equal((await call('POST', '/documents', 'owner', { kind: 'PURCHASE', partyId: sup, lines: [{ productId: pipe, qtyMilli: 5000, ratePaisa: 45000 }] })).status, 201);
    const up = await api.upload('/scans', 'owner', 'pages', photo(), 'bill.png', { type: 'PURCHASE' });
    assert.equal(up.status, 201, JSON.stringify(up.json));
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  test('owner downloads Excel + photos for their shop only (FR-SET-05)', async () => {
    assert.equal((await api.call('GET', '/export', 'acct')).status, 403, 'owner only');
    const r = await api.call('GET', '/export', 'owner');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition') ?? '', /shop-export-\d{4}-\d{2}-\d{2}\.zip/);
    const zip = await JSZip.loadAsync(r.bytes);
    const names = Object.keys(zip.files);
    assert.ok(names.includes('README.txt'));
    assert.equal(names.filter((n) => /^photos\/.+\/page-1\.png$/.test(n)).length, 1, 'the bill photo is in the zip');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await zip.file('shop-data.xlsx')!.async('nodebuffer')) as unknown as ArrayBuffer);
    const sheet = (n: string) => wb.getWorksheet(n)!;
    const header = (n: string) => (sheet(n).getRow(1).values as unknown[]).slice(1);
    const col = (n: string, key: string) => sheet(n).getColumn(header(n).indexOf(key) + 1).values.slice(2);
    assert.deepEqual(col('Products', 'name'), ['PVC Pipe 1 inch']);
    assert.ok(!JSON.stringify(wb.worksheets.map((w) => w.getSheetValues())).includes('Secret Other Product'), 'nothing from the other shop');
    assert.ok(!header('Users').includes('passwordHash'), 'no password hashes');
    assert.equal(col('Users', 'role').length, 4);
    assert.deepEqual(col('Documents', 'totalPaisa'), [225000]);
    assert.deepEqual(col('Document lines', 'qty'), [5]);
    const audit = await db.auditLog.findFirst({ where: { shopId: id.shop, action: 'data.export' } });
    assert.ok(audit, 'the export is in the audit log');
  });

  test('backup status is for the owner; pg_dump writes a backup and old ones are pruned', async () => {
    assert.equal((await api.call('GET', '/backup/status', 'acct')).status, 403);
    const s = await api.call('GET', '/backup/status', 'owner');
    assert.equal(s.status, 200);
    assert.equal(s.json.enabled, false, 'tests run with the scheduler off');

    const dir = mkdtempSync(join(tmpdir(), 'erp-backup-'));
    try {
      const svc = new BackupService({ ...testConfig(url!), BACKUP_ENABLED: true, BACKUP_DIR: dir, BACKUP_KEEP: 2 });
      const first = await svc.backup();
      assert.match(first.name, /_test-\d{8}-\d{6}\.dump$/);
      assert.ok(first.bytes > 10_000, 'a real dump');
      for (let i = 0; i < 2; i++) {
        await new Promise((r) => setTimeout(r, 1100)); // names have seconds
        await svc.backup();
      }
      const files = await svc.list();
      assert.equal(files.length, 2, 'only the newest BACKUP_KEEP files stay');
      assert.ok(!existsSync(join(dir, first.name)));
      assert.equal((await svc.status()).lastError, null);

      const broken = new BackupService({ ...testConfig(url!), BACKUP_DIR: dir, PG_DUMP: join(dir, 'no-such-pg_dump') });
      await assert.rejects(broken.backup());
      assert.ok((await broken.status()).lastError);
      assert.equal((await broken.list()).length, 2, 'a failed backup leaves the good ones alone');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
