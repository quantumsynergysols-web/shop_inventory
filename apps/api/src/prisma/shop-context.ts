import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthUser } from '../auth/decorators.js';

/**
 * NFR-SEC-02: which shop the current request acts for. PrismaService reads it to set
 * app.shop_id for every query, so PostgreSQL's row-level security hides other shops' rows.
 */
export interface ShopStore {
  shopId: string;
  /** Inside an interactive transaction that already set app.shop_id */
  inTx?: boolean;
}

export const shopContext = new AsyncLocalStorage<ShopStore>();

/** Runs every authenticated handler (and work it starts) inside its shop's context. */
@Injectable()
export class ShopContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user?.shopId) return next.handle();
    return new Observable((sub) => shopContext.run({ shopId: user.shopId }, () => next.handle().subscribe(sub)));
  }
}
