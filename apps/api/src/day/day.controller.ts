import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DayService } from './day.service.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const payMode = z.enum(['CASH', 'BANK', 'JAZZCASH', 'EASYPAISA']);
const closeBody = z.object({
  countedCashPaisa: z.number().int().min(0).max(1e13),
  note: z.string().trim().max(300).nullable().optional(),
  date: ymd.optional(),
  force: z.boolean().optional(),
});
const expenseBody = z.object({
  headId: z.string().uuid(),
  amountPaisa: z.number().int().positive().max(1e12),
  paidFrom: payMode,
  note: z.string().trim().max(300).nullable().optional(),
});

/** Role checks for the day screen follow the permission matrix and are done in DayService. */
@Controller()
export class DayController {
  constructor(private readonly day: DayService) {}

  @Get('day')
  get(@CurrentUser() u: AuthUser, @Query(new ZodPipe(z.object({ date: ymd.optional() }))) q: { date?: string }) {
    return this.day.get(u, q.date);
  }

  @Post('day/close')
  close(@CurrentUser() u: AuthUser, @Body(new ZodPipe(closeBody)) body: z.infer<typeof closeBody>) {
    return this.day.close(u, body);
  }

  @Post('day/reopen')
  reopen(@CurrentUser() u: AuthUser, @Body(new ZodPipe(z.object({ date: ymd, reason: z.string().trim().min(3).max(300) }))) body: { date: string; reason: string }) {
    return this.day.reopen(u, body.date, body.reason);
  }

  @Get('day/month')
  month(@CurrentUser() u: AuthUser, @Query(new ZodPipe(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }))) q: { month: string }) {
    return this.day.month(u, q.month);
  }

  @Get('expense-heads')
  heads(@CurrentUser() u: AuthUser) {
    return this.day.heads(u.shopId);
  }

  @Post('expense-heads')
  addHead(@CurrentUser() u: AuthUser, @Body(new ZodPipe(z.object({ name: z.string().trim().min(1).max(80) }))) body: { name: string }) {
    return this.day.addHead(u, body.name);
  }

  @Post('expenses')
  addExpense(@CurrentUser() u: AuthUser, @Body(new ZodPipe(expenseBody)) body: z.infer<typeof expenseBody>) {
    return this.day.addExpense(u, body);
  }
}
