import { Injectable } from '@nestjs/common';
import type { Role } from '@erp/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthStore, StoredSession, StoredUser } from './auth.store.js';

@Injectable()
export class PrismaAuthStore implements AuthStore {
  constructor(private readonly db: PrismaService) {}

  private toUser(u: { id: string; shopId: string; role: string; name: string; passwordHash: string; active: boolean; failedLogins: number; lockedUntil: Date | null; shop: { status: StoredUser['shopStatus'] } }): StoredUser {
    const { shop, ...rest } = u;
    return { ...rest, role: u.role as Role, shopStatus: shop.status };
  }

  async findUserByLogin(login: string): Promise<StoredUser | null> {
    const l = login.trim();
    const u = await this.db.user.findFirst({ where: l.includes('@') ? { email: { equals: l, mode: 'insensitive' } } : { phone: l }, include: { shop: { select: { status: true } } } });
    return u ? this.toUser(u) : null;
  }

  async findUserById(id: string): Promise<StoredUser | null> {
    const u = await this.db.user.findUnique({ where: { id }, include: { shop: { select: { status: true } } } });
    return u ? this.toUser(u) : null;
  }

  async setLoginFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
    await this.db.user.update({ where: { id: userId }, data: { failedLogins, lockedUntil } });
  }

  createSession(s: { userId: string; tokenHash: string; expiresAt: Date; userAgent: string | null }): Promise<StoredSession> {
    return this.db.session.create({ data: s, select: { id: true, userId: true, tokenHash: true, expiresAt: true, revokedAt: true } });
  }

  findSessionByHash(tokenHash: string): Promise<StoredSession | null> {
    return this.db.session.findUnique({ where: { tokenHash }, select: { id: true, userId: true, tokenHash: true, expiresAt: true, revokedAt: true } });
  }

  async touchSession(id: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db.session.update({ where: { id }, data: { tokenHash, expiresAt, lastUsedAt: new Date() } });
  }

  async revokeSession(id: string): Promise<void> {
    await this.db.session.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  async audit(entry: { shopId: string; userId: string | null; action: string; entity: string; entityId?: string }): Promise<void> {
    await this.db.auditLog.create({ data: { shopId: entry.shopId, userId: entry.userId, action: entry.action, entity: entry.entity, entityId: entry.entityId ?? null } });
  }
}
