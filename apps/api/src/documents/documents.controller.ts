import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Requires, type AuthUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DocumentsService } from './documents.service.js';

const money = z.number().int().min(0).max(1e13);
const payMode = z.enum(['CASH', 'BANK', 'JAZZCASH', 'EASYPAISA']);

/** Manual Stock IN / OUT without a photo (FR-STK-09). Scans confirm through the same service. */
export const postBody = z.object({
  kind: z.enum(['PURCHASE', 'SALE']),
  partyId: z.string().uuid().nullable().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qtyMilli: z.number().int().positive().max(1e12),
        unit: z.string().max(20).nullable().optional(),
        ratePaisa: money,
      }),
    )
    .min(1)
    .max(300),
  discountPaisa: money.optional(),
  payments: z.array(z.object({ mode: payMode, amountPaisa: money })).max(5).optional(),
  allowNegative: z.boolean().optional(),
  note: z.string().max(300).nullable().optional(),
});

const listQuery = z.object({
  kind: z.enum(['PURCHASE', 'SALE', 'SALES_RETURN', 'PURCHASE_RETURN', 'ADJUST_IN', 'ADJUST_OUT', 'OPENING', 'VOID']).optional(),
  partyId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Requires('dashboard.view')
  @Get()
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.docs.list(u.shopId, q);
  }

  @Requires('dashboard.view')
  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.get(u.shopId, id);
  }

  /** Send an Idempotency-Key header so a double tap never posts twice (NFR-REL-02). Role is checked per kind in the service. */
  @Post()
  post(@CurrentUser() u: AuthUser, @Body(new ZodPipe(postBody)) body: z.infer<typeof postBody>, @Headers('idempotency-key') key?: string) {
    return this.docs.post(u, { ...body, idempotencyKey: key?.slice(0, 100) ?? null });
  }

  @Requires('document.void')
  @Post(':id/void')
  void(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3).max(300) }))) body: { reason: string }) {
    return this.docs.void(u, id, body.reason);
  }
}
