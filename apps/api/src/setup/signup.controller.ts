import { Body, ConflictException, Controller, Get, Headers, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createShop, PhoneTakenError } from './first-shop.js';

const signupBody = z.object({
  shopName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(1).max(100),
  phone: z.string().trim().regex(/^[0-9+\- ]{7,20}$/, 'phone number'),
  password: z.string().min(8, 'at least 8 characters').max(200),
  city: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

/**
 * Online sign-up (SIGNUP_ENABLED): a new shop asks for an account. It is created PENDING, with a
 * trial of SIGNUP_TRIAL_SCANS AI scans a month on the QSSols key, and its owner can log in only
 * after QSSols approves it on the admin page.
 */
@Controller('signup')
export class SignupController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: PrismaService,
  ) {}

  @Public()
  @Get()
  status() {
    return { enabled: this.config.SIGNUP_ENABLED };
  }

  @Public()
  @Post()
  async signup(@Body(new ZodPipe(signupBody)) b: z.infer<typeof signupBody>) {
    if (!this.config.SIGNUP_ENABLED) throw new NotFoundException();
    try {
      await createShop(this.db, b, { status: 'PENDING', monthlyScanQuota: this.config.SIGNUP_TRIAL_SCANS, signup: { city: b.city ?? null, note: b.note ?? null, at: new Date().toISOString() } });
    } catch (e) {
      if (e instanceof PhoneTakenError) throw new ConflictException('This phone number already has an account. Log in instead, or use another number.');
      throw e;
    }
    return { ok: true, status: 'PENDING' };
  }
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * QSSols admin (PLATFORM_ADMIN_KEY in the x-admin-key header): the sign-up list, approve/reject, and
 * each shop's AI scan limit. Not a shop login; off when no key is configured.
 */
@Controller('admin')
export class PlatformAdminController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: PrismaService,
  ) {}

  private check(key?: string) {
    const real = this.config.PLATFORM_ADMIN_KEY;
    if (!real || !key || !timingSafeEqual(digest(key), digest(real))) throw new UnauthorizedException('Wrong admin key');
  }

  @Public()
  @Get('shops')
  async shops(@Headers('x-admin-key') key?: string) {
    this.check(key);
    const shops = await this.db.shop.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { users: { where: { role: 'OWNER' }, select: { name: true, phone: true }, take: 1 }, aiSetting: { select: { monthlyScanQuota: true } }, _count: { select: { documents: true } } },
    });
    return shops.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      createdAt: s.createdAt,
      owner: s.users[0] ?? null,
      signup: s.signup,
      monthlyScanQuota: s.aiSetting?.monthlyScanQuota ?? null,
      defaultQuota: this.config.HOSTED_MONTHLY_SCANS,
      documents: s._count.documents,
    }));
  }

  @Public()
  @Post('shops/:id/:decision')
  async decide(@Param('id', ParseUUIDPipe) id: string, @Param('decision') decision: string, @Headers('x-admin-key') key?: string) {
    this.check(key);
    if (decision !== 'approve' && decision !== 'reject') throw new NotFoundException();
    const shop = await this.db.shop.findUnique({ where: { id } });
    if (!shop) throw new NotFoundException('Shop not found');
    const status = decision === 'approve' ? 'ACTIVE' : 'REJECTED';
    await this.db.shop.update({ where: { id }, data: { status } });
    await this.db.auditLog.create({ data: { shopId: id, userId: null, action: `signup.${decision}`, entity: 'shop', entityId: id, before: { status: shop.status }, after: { status } } });
    return { id, status };
  }

  @Public()
  @Patch('shops/:id/quota')
  async quota(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ monthlyScanQuota: z.number().int().min(0).max(100_000).nullable() }))) b: { monthlyScanQuota: number | null }, @Headers('x-admin-key') key?: string) {
    this.check(key);
    await this.db.aiSetting.upsert({ where: { shopId: id }, create: { shopId: id, monthlyScanQuota: b.monthlyScanQuota }, update: { monthlyScanQuota: b.monthlyScanQuota } });
    await this.db.auditLog.create({ data: { shopId: id, userId: null, action: 'admin.scan_quota', entity: 'ai_setting', entityId: id, after: { monthlyScanQuota: b.monthlyScanQuota } } });
    return { id, monthlyScanQuota: b.monthlyScanQuota };
  }
}
