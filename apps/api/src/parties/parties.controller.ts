import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PartiesService } from './parties.service.js';

const partyType = z.enum(['SUPPLIER', 'CUSTOMER', 'BOTH']);
const payMode = z.enum(['CASH', 'BANK', 'JAZZCASH', 'EASYPAISA']);

const createBody = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  type: partyType,
  /** Positive: they owe the shop. Negative: the shop owes them. */
  openingBalancePaisa: z.number().int().min(-1e13).max(1e13).optional(),
});
const paymentBody = z.object({
  direction: z.enum(['RECEIVED', 'PAID']),
  amountPaisa: z.number().int().positive().max(1e13),
  mode: payMode,
  note: z.string().max(300).nullable().optional(),
});

/** Visibility per role (customers / suppliers) is applied inside the service, per the permission matrix. */
@Controller('parties')
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(z.object({ q: z.string().max(200).optional(), type: partyType.optional() }))) q: { q?: string; type?: z.infer<typeof partyType> }) {
    return this.parties.list(u, q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.parties.get(u, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>) {
    return this.parties.create(u, body);
  }

  @Post(':id/payments')
  pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(paymentBody)) body: z.infer<typeof paymentBody>) {
    return this.parties.recordPayment(u, id, body);
  }
}
