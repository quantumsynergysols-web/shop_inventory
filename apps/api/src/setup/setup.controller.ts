import { Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createFirstShop } from './first-shop.js';

const setupBody = z.object({
  shopName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(1).max(100),
  phone: z.string().trim().regex(/^[0-9+\- ]{7,20}$/, 'phone number'),
  password: z.string().min(8, 'at least 8 characters').max(200),
  address: z.string().trim().max(300).nullable().optional(),
  shopPhone: z.string().trim().max(40).nullable().optional(),
});

/**
 * First-run setup for the desktop app (SETUP_ENABLED=true): while the database has no shop, the
 * person installing the app creates the shop and its owner login. Once a shop exists it refuses.
 * On a server (Vercel, VPS) it is off and the shop is created with the seed command instead.
 */
@Controller('setup')
export class SetupController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: PrismaService,
  ) {}

  @Public()
  @Get()
  async status() {
    if (!this.config.SETUP_ENABLED) return { needed: false };
    return { needed: (await this.db.shop.count()) === 0 };
  }

  @Public()
  @Post()
  async setup(@Body(new ZodPipe(setupBody)) b: z.infer<typeof setupBody>, @Req() req: { ip?: string; socket?: { remoteAddress?: string } }) {
    if (!this.config.SETUP_ENABLED) throw new NotFoundException();
    // Only from the PC the app is installed on, never from a phone on the shop's Wi-Fi
    const ip = req.socket?.remoteAddress ?? req.ip ?? '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) throw new ForbiddenException('Set up the app on the PC it is installed on');
    const made = await createFirstShop(this.db, b);
    if (!made) throw new ConflictException('This app is already set up; log in instead');
    return { ok: true };
  }
}
