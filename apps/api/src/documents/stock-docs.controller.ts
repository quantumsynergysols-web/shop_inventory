import { BadRequestException, Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { CurrentUser, Requires, type AuthUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { OPENING_TEMPLATE, StockDocsService } from './stock-docs.service.js';

const money = z.number().int().min(0).max(1e13);
const payMode = z.enum(['CASH', 'BANK', 'JAZZCASH', 'EASYPAISA']);
const qty = z.number().int().min(0).max(1e12);

const returnBody = z.object({
  lines: z.array(z.object({ lineNo: z.number().int().min(1), qtyMilli: qty })).min(1).max(300),
  refunds: z.array(z.object({ mode: payMode, amountPaisa: money })).max(5).optional(),
  reason: z.string().trim().min(3).max(300),
});

const adjustBody = z.object({
  reason: z.string().trim().min(3).max(300),
  lines: z
    .array(
      z
        .object({ productId: z.string().uuid(), deltaMilli: z.number().int().min(-1e12).max(1e12).optional(), countedMilli: qty.optional() })
        .refine((l) => (l.deltaMilli == null) !== (l.countedMilli == null), 'Give either deltaMilli or countedMilli'),
    )
    .min(1)
    .max(500),
});

interface MulterFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

@Controller()
export class StockDocsController {
  constructor(private readonly svc: StockDocsService) {}

  /** FR-STK-06: return some or all of a sale or purchase. Role is checked per kind in the service. */
  @Post('documents/:id/return')
  createReturn(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(returnBody)) body: z.infer<typeof returnBody>, @Headers('idempotency-key') key?: string) {
    return this.svc.createReturn(u, id, body, key?.slice(0, 100) ?? null);
  }

  /** FR-STK-07: owner stock adjustment or physical count. */
  @Requires('stock.adjust')
  @Post('adjustments')
  adjust(@CurrentUser() u: AuthUser, @Body(new ZodPipe(adjustBody)) body: z.infer<typeof adjustBody>, @Headers('idempotency-key') key?: string) {
    return this.svc.adjust(u, body, key?.slice(0, 90) ?? null);
  }

  @Requires('stock.import_opening')
  @Get('opening-stock/template.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="opening-stock-template.csv"')
  template() {
    return OPENING_TEMPLATE;
  }

  /** FR-STK-08: multipart "file" (CSV or XLSX). ?dryRun=1 only checks it and returns the preview. */
  @Requires('stock.import_opening')
  @Post('opening-stock')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  importOpening(@CurrentUser() u: AuthUser, @UploadedFile() file: MulterFile | undefined, @Query('dryRun') dryRun?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Attach the file as "file"');
    return dryRun === '1' || dryRun === 'true' ? this.svc.previewOpening(u, file.buffer, file.originalname) : this.svc.importOpening(u, file.buffer, file.originalname);
  }
}
