import type { Prisma } from '@prisma/client';

/**
 * Next number in a gap-free sequence per shop (doc numbers, SKUs, receipt numbers FR-RCP-04).
 * Must run inside the same transaction as the insert that uses it: the row lock taken by
 * the upsert makes concurrent callers wait, and a rollback gives the number back.
 */
export async function nextNumber(tx: Prisma.TransactionClient, shopId: string, kind: string): Promise<number> {
  const rows = await tx.$queryRaw<{ next: number }[]>`
    INSERT INTO "doc_counter" ("shopId", "kind", "next") VALUES (${shopId}::uuid, ${kind}, 2)
    ON CONFLICT ("shopId", "kind") DO UPDATE SET "next" = "doc_counter"."next" + 1
    RETURNING "next" - 1 AS "next"`;
  const n = rows[0]?.next;
  if (n == null) throw new Error(`counter ${kind} failed`);
  return Number(n);
}

export const DOC_PREFIX: Record<string, string> = {
  PURCHASE: 'PUR',
  SALE: 'SAL',
  SALES_RETURN: 'SRT',
  PURCHASE_RETURN: 'PRT',
  ADJUST_IN: 'ADJ',
  ADJUST_OUT: 'ADJ',
  OPENING: 'OPN',
  VOID: 'VOD',
};

export const formatNo = (prefix: string, n: number) => `${prefix}-${String(n).padStart(6, '0')}`;
