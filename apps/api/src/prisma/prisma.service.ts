import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { shopContext } from './shop-context.js';

const setShop = (client: { $executeRaw: PrismaClient['$executeRaw'] }, shopId: string) =>
  client.$executeRaw`SELECT set_config('app.shop_id', ${shopId}, true)`;

/**
 * Connects lazily on the first query, so the API starts (and /health reports "db down")
 * even when PostgreSQL is not reachable. Uses the URL from the validated config.
 *
 * NFR-SEC-02: when a request acts for a shop (see shop-context.ts), every query runs in a
 * transaction that first sets app.shop_id, and the row-level security policies of migration
 * 20261118120000_row_level_security limit it to that shop. Interactive transactions set it once
 * at their start. The services still filter by shopId too; the database is the second wall.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ datasources: { db: { url: config.DATABASE_URL } } });
    const base = this as PrismaClient;
    const scoped = base.$extends({
      query: {
        async $allOperations({ args, query }) {
          const s = shopContext.getStore();
          if (!s?.shopId || s.inTx) return query(args);
          const [, result] = await base.$transaction([setShop(base, s.shopId), query(args) as Prisma.PrismaPromise<unknown>]);
          return result;
        },
      },
    });
    const interactive = scoped.$transaction.bind(scoped) as (...a: unknown[]) => Promise<unknown>;
    const wrapped = new Proxy(scoped, {
      get(target, prop, receiver) {
        if (prop === '$transaction') {
          return (arg: unknown, opts?: unknown) => {
            const s = shopContext.getStore();
            if (!s?.shopId || s.inTx) return interactive(arg, opts);
            if (Array.isArray(arg)) {
              // Batch: set the shop as the batch's first statement; its queries then run as they are
              return shopContext.run({ shopId: s.shopId, inTx: true }, async () => {
                const results = (await interactive([setShop(base, s.shopId), ...arg], opts)) as unknown[];
                return results.slice(1);
              });
            }
            return interactive(
              (tx: PrismaClient) =>
                shopContext.run({ shopId: s.shopId, inTx: true }, async () => {
                  await setShop(tx, s.shopId);
                  return (arg as (t: PrismaClient) => unknown)(tx);
                }),
              opts,
            );
          };
        }
        if (prop === 'isUp') return () => base.$queryRaw`SELECT 1`.then(() => true, () => false);
        if (prop === 'onModuleDestroy') return () => base.$disconnect();
        return Reflect.get(target, prop, receiver);
      },
    });
    return wrapped as unknown as PrismaService;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async isUp(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
