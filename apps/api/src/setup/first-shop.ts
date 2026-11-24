import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizeName } from '@erp/domain';
import { hashPassword } from '../auth/password.js';

/** FR-PRD-06 preset categories and FR-EXP-01 expense heads for a new shop. */
export const CATEGORIES = ['Plumbing', 'Sanitary', 'Electrical', 'Crockery', 'Hardware', 'General'];
export const EXPENSE_HEADS = ['Tea / food', 'Labour', 'Rent', 'Electricity', 'Transport', 'Salary', 'Other'];

export interface FirstShopInput {
  shopName: string;
  ownerName: string;
  phone: string;
  password: string;
  address?: string | null;
  shopPhone?: string | null;
}

/**
 * Creates the first shop with its owner, preset categories, expense heads and the Walk-in customer.
 * Returns null when a shop already exists (the database is never set up twice). Runs in one
 * transaction holding an advisory lock, so two setup requests at once cannot both create a shop.
 */
export async function createFirstShop(db: PrismaClient, input: FirstShopInput): Promise<{ shopId: string; ownerId: string } | null> {
  const passwordHash = await hashPassword(input.password);
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`;
    if ((await tx.shop.count()) > 0) return null;
    const shop = await tx.shop.create({
      data: {
        name: input.shopName,
        address: input.address ?? null,
        phone: input.shopPhone ?? null,
        settings: { markupPct: 25, allowNegativeStock: false, lowStockDefault: 5, salesmanMayCloseDay: false, salesmanExpenseLimitPaisa: 100_000, closingNoteLimitPaisa: 50_000 },
        categories: { create: CATEGORIES.map((name) => ({ name })) },
        expenseHeads: { create: EXPENSE_HEADS.map((name) => ({ name })) },
        aiSetting: { create: {} },
      },
    });
    const owner = await tx.user.create({ data: { shopId: shop.id, name: input.ownerName, phone: input.phone, role: 'OWNER', passwordHash } });
    await tx.party.create({ data: { shopId: shop.id, name: 'Walk-in', normalizedName: normalizeName('Walk-in'), type: 'CUSTOMER' } });
    await tx.auditLog.create({ data: { shopId: shop.id, userId: owner.id, action: 'setup', entity: 'shop', entityId: shop.id } });
    return { shopId: shop.id, ownerId: owner.id };
  });
}
