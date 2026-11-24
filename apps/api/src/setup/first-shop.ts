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

export interface NewShopOptions {
  /** Online sign-up: PENDING until QSSols approves */
  status?: 'ACTIVE' | 'PENDING';
  /** Details shown on the approval list */
  signup?: Prisma.InputJsonValue;
  /** Scans on the QSSols AI key per month; null = the server default */
  monthlyScanQuota?: number | null;
  /** Desktop setup and seed: only when the database has no shop yet */
  onlyIfEmpty?: boolean;
}

export class PhoneTakenError extends Error {}

/**
 * Creates a shop with its owner, preset categories, expense heads and the Walk-in customer, in one
 * transaction holding an advisory lock (two requests at once cannot both pass the checks).
 * Returns null when onlyIfEmpty is set and a shop already exists; throws PhoneTakenError when the
 * owner's phone already logs in somewhere.
 */
export async function createShop(db: PrismaClient, input: FirstShopInput, o: NewShopOptions = {}): Promise<{ shopId: string; ownerId: string } | null> {
  const passwordHash = await hashPassword(input.password);
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`;
    if (o.onlyIfEmpty && (await tx.shop.count()) > 0) return null;
    if (await tx.user.findFirst({ where: { phone: input.phone }, select: { id: true } })) throw new PhoneTakenError('This phone number is already used for a login');
    const shop = await tx.shop.create({
      data: {
        name: input.shopName,
        address: input.address ?? null,
        phone: input.shopPhone ?? null,
        status: o.status ?? 'ACTIVE',
        ...(o.signup !== undefined ? { signup: o.signup } : {}),
        settings: { markupPct: 25, allowNegativeStock: false, lowStockDefault: 5, salesmanMayCloseDay: false, salesmanExpenseLimitPaisa: 100_000, closingNoteLimitPaisa: 50_000 },
        categories: { create: CATEGORIES.map((name) => ({ name })) },
        expenseHeads: { create: EXPENSE_HEADS.map((name) => ({ name })) },
        aiSetting: { create: o.monthlyScanQuota != null ? { monthlyScanQuota: o.monthlyScanQuota } : {} },
      },
    });
    const owner = await tx.user.create({ data: { shopId: shop.id, name: input.ownerName, phone: input.phone, role: 'OWNER', passwordHash } });
    await tx.party.create({ data: { shopId: shop.id, name: 'Walk-in', normalizedName: normalizeName('Walk-in'), type: 'CUSTOMER' } });
    await tx.auditLog.create({ data: { shopId: shop.id, userId: owner.id, action: o.status === 'PENDING' ? 'signup' : 'setup', entity: 'shop', entityId: shop.id } });
    return { shopId: shop.id, ownerId: owner.id };
  });
}

/** Desktop first run and the seed command: the first shop of an empty database. */
export const createFirstShop = (db: PrismaClient, input: FirstShopInput) => createShop(db, input, { onlyIfEmpty: true });
