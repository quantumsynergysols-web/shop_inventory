import { z } from 'zod';

/** FR-SET-03 defaults, stored in shop.settings (JSON). Unknown keys are kept, missing ones take these defaults. */
export const shopSettingsSchema = z.object({
  markupPct: z.number().min(0).max(1000).default(25),
  allowNegativeStock: z.boolean().default(false),
  lowStockDefault: z.number().min(0).default(5),
  salesmanMayCloseDay: z.boolean().default(false),
  salesmanExpenseLimitPaisa: z.number().int().min(0).default(100_000),
  closingNoteLimitPaisa: z.number().int().min(0).default(50_000),
  /** FR-CLS-04: cash already in the galla when the shop started; opening cash until the first day is closed */
  startingCashPaisa: z.number().int().min(0).default(0),
});

export type ShopSettings = z.infer<typeof shopSettingsSchema>;

export function readSettings(json: unknown): ShopSettings {
  const r = shopSettingsSchema.safeParse(json ?? {});
  return r.success ? r.data : shopSettingsSchema.parse({});
}
