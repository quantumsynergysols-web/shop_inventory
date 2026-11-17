import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Requires, type AuthUser } from '../auth/decorators.js';
import { hashPassword } from '../auth/password.js';
import { readSettings, shopSettingsSchema } from '../common/shop-settings.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { jsonSafe } from '../products/products.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const role = z.enum(['OWNER', 'SALESMAN', 'STOREKEEPER', 'ACCOUNTANT']);
const phone = z.string().trim().regex(/^[0-9+\- ]{7,20}$/, 'phone number');
const password = z.string().min(8, 'at least 8 characters').max(200);
const createUser = z.object({ name: z.string().trim().min(1).max(100), phone, email: z.string().trim().email().max(120).nullable().optional(), role, password });
const updateUser = z.object({ name: z.string().trim().min(1).max(100).optional(), role: role.optional(), active: z.boolean().optional() });
const settingsBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  address: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  ntn: z.string().trim().max(30).nullable().optional(),
  receiptFooter: z.string().trim().max(200).nullable().optional(),
  defaults: shopSettingsSchema.partial().optional(),
});

const userView = (u: { id: string; name: string; phone: string | null; email: string | null; role: string; active: boolean; lockedUntil: Date | null; createdAt: Date }) => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  email: u.email,
  role: u.role,
  active: u.active,
  locked: !!u.lockedUntil && u.lockedUntil > new Date(),
  createdAt: u.createdAt,
});
const normPhone = (p: string) => p.replace(/[\s-]/g, '');

/** FR-AUTH-04 and FR-SET-01/03: owner only (settings.manage). */
@Controller()
export class UsersController {
  constructor(private readonly db: PrismaService) {}

  @Requires('settings.manage')
  @Get('users')
  async list(@CurrentUser() u: AuthUser) {
    return (await this.db.user.findMany({ where: { shopId: u.shopId }, orderBy: { createdAt: 'asc' } })).map(userView);
  }

  @Requires('settings.manage')
  @Post('users')
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createUser)) b: z.infer<typeof createUser>) {
    const user = await this.db.user.create({
      data: { shopId: u.shopId, name: b.name, phone: normPhone(b.phone), email: b.email?.toLowerCase() ?? null, role: b.role, passwordHash: await hashPassword(b.password) },
    });
    await this.db.auditLog.create({ data: { shopId: u.shopId, userId: u.userId, action: 'user.create', entity: 'user', entityId: user.id, after: { name: b.name, role: b.role } } });
    return userView(user);
  }

  @Requires('settings.manage')
  @Patch('users/:id')
  async update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateUser)) b: z.infer<typeof updateUser>) {
    const before = await this.db.user.findFirst({ where: { id, shopId: u.shopId } });
    if (!before) throw new NotFoundException('User not found');
    const losingOwner = before.role === 'OWNER' && ((b.role && b.role !== 'OWNER') || b.active === false);
    if (losingOwner) {
      if (id === u.userId) throw new BadRequestException('You cannot remove your own owner access');
      const owners = await this.db.user.count({ where: { shopId: u.shopId, role: 'OWNER', active: true } });
      if (owners <= 1) throw new BadRequestException('The shop needs at least one active owner');
    }
    const user = await this.db.$transaction(async (tx) => {
      const x = await tx.user.update({ where: { id }, data: b });
      if (b.active === false || (b.role && b.role !== before.role)) await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { shopId: u.shopId, userId: u.userId, action: 'user.update', entity: 'user', entityId: id, before: { role: before.role, active: before.active }, after: b } });
      return x;
    });
    return userView(user);
  }

  /** Signs the user out everywhere and clears any lockout. */
  @Requires('settings.manage')
  @Post('users/:id/reset-password')
  async resetPassword(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ password }))) b: { password: string }) {
    const target = await this.db.user.findFirst({ where: { id, shopId: u.shopId } });
    if (!target) throw new NotFoundException('User not found');
    await this.db.$transaction([
      this.db.user.update({ where: { id }, data: { passwordHash: await hashPassword(b.password), failedLogins: 0, lockedUntil: null } }),
      this.db.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.db.auditLog.create({ data: { shopId: u.shopId, userId: u.userId, action: 'user.reset_password', entity: 'user', entityId: id } }),
    ]);
    return { ok: true };
  }

  /** Shop profile is readable by everyone signed in (receipt header); defaults too. */
  @Get('settings')
  async getSettings(@CurrentUser() u: AuthUser) {
    const s = await this.db.shop.findUniqueOrThrow({ where: { id: u.shopId } });
    return { name: s.name, address: s.address, phone: s.phone, ntn: s.ntn, receiptFooter: s.receiptFooter, defaults: readSettings(s.settings), aiConsentAt: s.aiConsentAt, plan: s.plan };
  }

  @Requires('settings.manage')
  @Patch('settings')
  async updateSettings(@CurrentUser() u: AuthUser, @Body(new ZodPipe(settingsBody)) b: z.infer<typeof settingsBody>) {
    const before = await this.db.shop.findUniqueOrThrow({ where: { id: u.shopId } });
    const { defaults, ...profile } = b;
    const merged = defaults ? { ...(before.settings as object), ...readSettings(before.settings), ...defaults } : undefined;
    await this.db.shop.update({ where: { id: u.shopId }, data: { ...profile, ...(merged ? { settings: merged } : {}) } });
    await this.db.auditLog.create({ data: { shopId: u.shopId, userId: u.userId, action: 'settings.update', entity: 'shop', entityId: u.shopId, before: jsonSafe({ name: before.name, settings: before.settings }), after: jsonSafe(b) } });
    return this.getSettings(u);
  }
}
