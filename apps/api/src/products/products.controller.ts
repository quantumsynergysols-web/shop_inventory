import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Requires, type AuthUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ProductsService } from './products.service.js';

const money = z.number().int().min(0).max(1e13);
const productBody = z.object({
  name: z.string().trim().min(1).max(200),
  categoryId: z.string().uuid().nullable().optional(),
  baseUnit: z.string().max(20).optional(),
  purchasePricePaisa: money.optional(),
  salePricePaisa: money.optional(),
  wholesalePricePaisa: money.nullable().optional(),
  /** In base units, up to 3 decimals */
  minLevel: z.number().min(0).max(1e9).optional(),
  aliases: z.array(z.string().trim().max(200)).max(50).optional(),
  units: z.array(z.object({ unit: z.string().max(20), factorToBase: z.number().positive().max(1e6) })).max(10).optional(),
  active: z.boolean().optional(),
});
const listQuery = z.object({
  q: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  lowStock: z.enum(['1', 'true']).optional(),
  includeInactive: z.enum(['1', 'true']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Requires('product.view')
  @Get('products')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.products.list(u.shopId, { q: q.q, categoryId: q.categoryId, lowStock: !!q.lowStock, includeInactive: !!q.includeInactive, limit: q.limit });
  }

  @Requires('product.view')
  @Get('products/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.get(u.shopId, id);
  }

  @Requires('product.view')
  @Get('products/:id/price-history')
  history(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.priceHistory(u.shopId, id);
  }

  /**
   * Owner, plus storekeeper and salesman while reviewing a scan (FR-REV-10/15:
   * "create new product" on the review screen). Price edits on existing products stay owner-only.
   */
  @Requires('product.create')
  @Post('products')
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(productBody)) body: z.infer<typeof productBody>) {
    return this.products.create(u, body);
  }

  @Requires('product.edit')
  @Patch('products/:id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(productBody.partial())) body: z.infer<typeof productBody>) {
    return this.products.update(u, id, body);
  }

  @Requires('product.view')
  @Get('categories')
  categories(@CurrentUser() u: AuthUser) {
    return this.products.categories(u.shopId);
  }

  @Requires('product.edit')
  @Post('categories')
  createCategory(@CurrentUser() u: AuthUser, @Body(new ZodPipe(z.object({ name: z.string().trim().min(1).max(80) }))) body: { name: string }) {
    return this.products.createCategory(u.shopId, body.name);
  }
}
