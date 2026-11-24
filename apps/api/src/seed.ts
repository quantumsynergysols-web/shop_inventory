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
import { createFirstShop } from './setup/first-shop.js';

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
    const shopName = process.env.SEED_SHOP_NAME ?? 'Demo Shop';
    await createFirstShop(db, { shopName, ownerName: process.env.SEED_OWNER_NAME ?? 'Owner', phone, password });
    console.log(`Seeded shop "${shopName}" with owner login ${phone}.`);
  }
} finally {
  await db.$disconnect();
}
