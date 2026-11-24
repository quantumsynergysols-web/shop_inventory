import type { Role } from '@erp/domain';

/** What the auth service needs from storage. PrismaAuthStore in production, an in-memory store in tests. */
export interface StoredUser {
  id: string;
  shopId: string;
  role: Role;
  name: string;
  passwordHash: string;
  active: boolean;
  /** ACTIVE, or PENDING / REJECTED for an online sign-up that QSSols has not approved */
  shopStatus: 'ACTIVE' | 'PENDING' | 'REJECTED';
  failedLogins: number;
  lockedUntil: Date | null;
}

export interface StoredSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AuthStore {
  /** By phone number or email, ignoring case for email */
  findUserByLogin(login: string): Promise<StoredUser | null>;
  findUserById(id: string): Promise<StoredUser | null>;
  setLoginFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void>;
  createSession(s: { userId: string; tokenHash: string; expiresAt: Date; userAgent: string | null }): Promise<StoredSession>;
  findSessionByHash(tokenHash: string): Promise<StoredSession | null>;
  /** Rotate the token and slide the expiry forward */
  touchSession(id: string, tokenHash: string, expiresAt: Date): Promise<void>;
  revokeSession(id: string): Promise<void>;
  /** Writes to audit_log (FR-SET-04) */
  audit(entry: { shopId: string; userId: string | null; action: string; entity: string; entityId?: string }): Promise<void>;
}

export const AUTH_STORE = Symbol('AUTH_STORE');
