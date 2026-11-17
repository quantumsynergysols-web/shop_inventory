/**
 * Creates the first shop and its owner on an empty database, with the preset
 * categories (FR-PRD-06) and expense heads (FR-EXP-01).
 *
 *   npm run db:seed --workspace @erp/api
 *
 * Reads SEED_SHOP_NAME, SEED_OWNER_NAME, SEED_OWNER_PHONE and SEED_OWNER_PASSWORD from apps/api/.env.
 * If SEED_OWNER_PASSWORD is missing, a random one is generated and appended to .env (git-ignored).
 */
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { normalizeName } from '@erp/domain';
import { hashPassword } from './auth/password.js';

const CATEGORIES = ['Plumbing', 'Sanitary', 'Electrical', 'Crockery', 'Hardware', 'General'];
const EXPENSE_HEADS = ['Tea / food', 'Labour', 'Rent', 'Electricity', 'Transport', 'Salary', 'Other'];

const db = new PrismaClient();
try {
  if ((await db.shop.count()) > 0) {
    console.log('Database already has a shop; nothing seeded.');
  } else {
    const phone = process.env.SEED_OWNER_PHONE ?? '03000000001';
    let password = process.env.SEED_OWNER_PASSWORD;
    if (!password) {
      password = randomBytes(12).toString('base64url');
      appendFileSync(new URL('../.env', import.meta.url), `SEED_OWNER_PHONE="${phone}"\nSEED_OWNER_PASSWORD="${password}"\n`);
      console.log('Generated an owner password and saved it to apps/api/.env (SEED_OWNER_PASSWORD).');
    }
    const shop = await db.shop.create({
      data: {
        name: process.env.SEED_SHOP_NAME ?? 'Demo Shop',
        settings: { markupPct: 25, allowNegativeStock: false, lowStockDefault: 5, salesmanMayCloseDay: false, salesmanExpenseLimitPaisa: 100_000, closingNoteLimitPaisa: 50_000 },
        categories: { create: CATEGORIES.map((name) => ({ name })) },
        expenseHeads: { create: EXPENSE_HEADS.map((name) => ({ name })) },
        aiSetting: { create: {} },
      },
    });
    const owner = await db.user.create({
      data: { shopId: shop.id, name: process.env.SEED_OWNER_NAME ?? 'Owner', phone, role: 'OWNER', passwordHash: await hashPassword(password) },
    });
    await db.party.create({ data: { shopId: shop.id, name: 'Walk-in', normalizedName: normalizeName('Walk-in'), type: 'CUSTOMER' } });
    await db.auditLog.create({ data: { shopId: shop.id, userId: owner.id, action: 'seed', entity: 'shop', entityId: shop.id } });
    console.log(`Seeded shop "${shop.name}" with owner login ${phone}.`);
  }
} finally {
  await db.$disconnect();
}
