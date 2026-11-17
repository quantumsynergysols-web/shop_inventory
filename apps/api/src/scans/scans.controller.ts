import { BadRequestException, Body, Controller, Get, Headers, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { CurrentUser, Requires, type AuthUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { MAX_BYTES, MAX_PAGES, ScansService } from './scans.service.js';

const money = z.number().int().min(0).max(1e13);
const payMode = z.enum(['CASH', 'BANK', 'JAZZCASH', 'EASYPAISA']);

const createBody = z.object({
  type: z.enum(['PURCHASE', 'SALE']),
  /** Id made on the phone, so a re-sent offline upload is not saved twice */
  clientId: z.string().max(100).optional(),
});
const linesBody = z.object({
  lines: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        serialNo: z.number().int().min(0).max(100000).nullable().optional(),
        page: z.number().int().min(1).max(MAX_PAGES).optional(),
        rawName: z.string().max(300),
        qtyMilli: z.number().int().min(0).max(1e12).nullable(),
        unit: z.string().max(20).nullable().optional(),
        ratePaisa: money.nullable(),
        productId: z.string().uuid().nullable(),
      }),
    )
    .max(500),
});
const confirmBody = z.object({
  partyId: z.string().uuid().nullable().optional(),
  payments: z.array(z.object({ mode: payMode, amountPaisa: money })).max(5).optional(),
  discountPaisa: money.optional(),
  allowNegative: z.boolean().optional(),
  note: z.string().max(300).nullable().optional(),
});

interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller('scans')
export class ScansController {
  constructor(private readonly scans: ScansService) {}

  /** multipart/form-data: type, clientId?, pages (1–10 photos). Role is checked per type in the service. */
  @Post()
  @UseInterceptors(FilesInterceptor('pages', MAX_PAGES, { limits: { fileSize: MAX_BYTES, files: MAX_PAGES } }))
  create(@CurrentUser() u: AuthUser, @UploadedFiles() files: MulterFile[] | undefined, @Body() raw: unknown) {
    const body = createBody.safeParse(raw);
    if (!body.success) throw new BadRequestException({ message: 'Invalid request', issues: body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    return this.scans.create(u, body.data.type, (files ?? []).map((f) => ({ bytes: f.buffer, contentType: f.mimetype })), body.data.clientId ?? null);
  }

  @Requires('dashboard.view')
  @Get()
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(z.object({ status: z.enum(['PROCESSING', 'NEEDS_REVIEW', 'FAILED', 'CONFIRMED', 'DISCARDED']).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }))) q: { status?: 'PROCESSING' | 'NEEDS_REVIEW' | 'FAILED' | 'CONFIRMED' | 'DISCARDED'; limit?: number }) {
    return this.scans.list(u, q);
  }

  @Requires('dashboard.view')
  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.scans.get(u, id);
  }

  @Requires('dashboard.view')
  @Get(':id/pages/:pageNo')
  async page(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('pageNo', ParseIntPipe) pageNo: number, @Res() res: { setHeader(k: string, v: string): void; end(b: Buffer): void }) {
    const p = await this.scans.page(u, id, pageNo);
    res.setHeader('content-type', p.contentType);
    res.setHeader('cache-control', 'private, max-age=86400');
    res.end(p.bytes);
  }

  /** Autosave of the review screen (FR-REV-11): send all rows in their current state. */
  @Put(':id/lines')
  lines(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(linesBody)) body: z.infer<typeof linesBody>) {
    return this.scans.saveLines(u, id, body.lines);
  }

  @Post(':id/retry')
  retry(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.scans.retry(u, id);
  }

  @Post(':id/manual')
  manual(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.scans.continueManually(u, id);
  }

  @Post(':id/discard')
  discard(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.scans.discard(u, id);
  }

  @Post(':id/confirm')
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(confirmBody)) body: z.infer<typeof confirmBody>, @Headers('idempotency-key') key?: string) {
    return this.scans.confirm(u, id, body, key?.slice(0, 100) ?? null);
  }
}
