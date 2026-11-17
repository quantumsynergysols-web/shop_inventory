import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DayClosedError, InsufficientStockError, NoteRequiredError, StockShortageError, UnknownUnitError } from '@erp/domain';

/** Turns business-rule errors from @erp/domain and Prisma into clear HTTP answers. */
@Catch()
export class DomainErrorsFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<{ status(n: number): { json(b: unknown): void } }>();
    const send = (status: number, body: Record<string, unknown>) => res.status(status).json({ statusCode: status, ...body });

    if (err instanceof HttpException) {
      const r = err.getResponse();
      send(err.getStatus(), typeof r === 'string' ? { message: r } : (r as Record<string, unknown>));
      return;
    }
    if (err instanceof StockShortageError) {
      send(HttpStatus.CONFLICT, { code: 'STOCK_SHORTAGE', message: err.message, shortages: err.shortages });
      return;
    }
    if (err instanceof InsufficientStockError) {
      send(HttpStatus.CONFLICT, { code: 'STOCK_SHORTAGE', message: err.message });
      return;
    }
    if (err instanceof DayClosedError) {
      send(HttpStatus.CONFLICT, { code: 'DAY_CLOSED', message: err.message });
      return;
    }
    if (err instanceof NoteRequiredError) {
      send(HttpStatus.UNPROCESSABLE_ENTITY, { code: 'NOTE_REQUIRED', message: err.message, differencePaisa: err.differencePaisa });
      return;
    }
    if (err instanceof UnknownUnitError) {
      send(HttpStatus.UNPROCESSABLE_ENTITY, { code: 'UNKNOWN_UNIT', message: err.message });
      return;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        send(HttpStatus.CONFLICT, { code: 'DUPLICATE', message: `Already exists: ${String(err.meta?.target ?? '')}` });
        return;
      }
      if (err.code === 'P2025') {
        send(HttpStatus.NOT_FOUND, { code: 'NOT_FOUND', message: 'Not found' });
        return;
      }
    }
    if (err instanceof RangeError) {
      send(HttpStatus.BAD_REQUEST, { code: 'BAD_VALUE', message: err.message });
      return;
    }
    console.error(err);
    send(HttpStatus.INTERNAL_SERVER_ERROR, { message: 'Something went wrong' });
  }
}
