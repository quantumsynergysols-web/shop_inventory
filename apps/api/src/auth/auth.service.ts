import { createHash, randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { AUTH_STORE, type AuthStore, type StoredUser } from './auth.store.js';
import type { AuthUser } from './decorators.js';
import { dummyHash, verifyPassword } from './password.js';

export interface TokenPair {
  accessToken: string;
  /** Opaque; only its SHA-256 hash is stored */
  refreshToken: string;
  expiresIn: number;
  user: { id: string; name: string; role: StoredUser['role']; shopId: string };
}

/** One message for unknown user, wrong password and disabled user, so logins cannot be used to find accounts. */
const BAD_LOGIN = 'Phone/email or password is wrong';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_STORE) private readonly store: AuthStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
    /** Injected so tests can move time */
    @Inject('NOW') private readonly now: () => Date,
  ) {}

  /** FR-AUTH-01, NFR-SEC-04 */
  async login(login: string, password: string, userAgent: string | null): Promise<TokenPair> {
    const user = await this.store.findUserByLogin(login);
    if (!user) {
      await verifyPassword(await dummyHash(), password);
      throw new UnauthorizedException(BAD_LOGIN);
    }
    const now = this.now();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new HttpException(`Too many wrong passwords. Try again after ${user.lockedUntil.toISOString()}`, HttpStatus.LOCKED);
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok || !user.active) {
      if (!ok) {
        const failures = user.failedLogins + 1;
        if (failures >= this.config.MAX_FAILED_LOGINS) {
          await this.store.setLoginFailures(user.id, 0, new Date(now.getTime() + this.config.LOCKOUT_MINUTES * 60_000));
          await this.store.audit({ shopId: user.shopId, userId: user.id, action: 'auth.locked', entity: 'user', entityId: user.id });
        } else {
          await this.store.setLoginFailures(user.id, failures, null);
        }
      }
      throw new UnauthorizedException(BAD_LOGIN);
    }
    if (user.failedLogins !== 0 || user.lockedUntil) await this.store.setLoginFailures(user.id, 0, null);

    const refreshToken = randomBytes(32).toString('base64url');
    await this.store.createSession({ userId: user.id, tokenHash: sha256(refreshToken), expiresAt: this.sessionExpiry(now), userAgent });
    await this.store.audit({ shopId: user.shopId, userId: user.id, action: 'auth.login', entity: 'user', entityId: user.id });
    return this.tokens(user, refreshToken);
  }

  /** Rotates the refresh token; the old one stops working. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const session = await this.store.findSessionByHash(sha256(refreshToken));
    const now = this.now();
    if (!session || session.revokedAt || session.expiresAt <= now) throw new UnauthorizedException('Session expired, please log in again');
    const user = await this.store.findUserById(session.userId);
    if (!user || !user.active) {
      await this.store.revokeSession(session.id);
      throw new UnauthorizedException('Session expired, please log in again');
    }
    const next = randomBytes(32).toString('base64url');
    await this.store.touchSession(session.id, sha256(next), this.sessionExpiry(now));
    return this.tokens(user, next);
  }

  async logout(refreshToken: string): Promise<void> {
    const session = await this.store.findSessionByHash(sha256(refreshToken));
    if (session && !session.revokedAt) await this.store.revokeSession(session.id);
  }

  async verifyAccessToken(token: string): Promise<AuthUser> {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; shop: string; role: AuthUser['role'] }>(token);
      return { userId: p.sub, shopId: p.shop, role: p.role };
    } catch {
      throw new UnauthorizedException('Login required');
    }
  }

  private sessionExpiry(now: Date): Date {
    return new Date(now.getTime() + this.config.SESSION_IDLE_DAYS * 24 * 60 * 60_000);
  }

  private async tokens(user: StoredUser, refreshToken: string): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync({ sub: user.id, shop: user.shopId, role: user.role }, { expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS });
    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
      user: { id: user.id, name: user.name, role: user.role, shopId: user.shopId },
    };
  }
}
