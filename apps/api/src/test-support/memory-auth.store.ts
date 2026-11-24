import { randomUUID } from 'node:crypto';
import type { AuthStore, StoredSession, StoredUser } from '../auth/auth.store.js';

/** In-memory AuthStore for tests. Not used in production. */
export class MemoryAuthStore implements AuthStore {
  users: StoredUser[] = [];
  sessions: StoredSession[] = [];
  auditLog: { action: string; userId: string | null }[] = [];
  phones = new Map<string, string>();

  addUser(u: Omit<StoredUser, 'id' | 'failedLogins' | 'lockedUntil' | 'shopStatus'> & { phone: string; shopStatus?: StoredUser['shopStatus'] }): StoredUser {
    const user: StoredUser = { id: randomUUID(), failedLogins: 0, lockedUntil: null, name: u.name, shopId: u.shopId, role: u.role, passwordHash: u.passwordHash, active: u.active, shopStatus: u.shopStatus ?? 'ACTIVE' };
    this.users.push(user);
    this.phones.set(u.phone, user.id);
    return user;
  }

  async findUserByLogin(login: string): Promise<StoredUser | null> {
    const id = this.phones.get(login.trim());
    return this.users.find((u) => u.id === id) ?? null;
  }

  async findUserById(id: string): Promise<StoredUser | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }

  async setLoginFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
    const u = this.users.find((x) => x.id === userId)!;
    u.failedLogins = failedLogins;
    u.lockedUntil = lockedUntil;
  }

  async createSession(s: { userId: string; tokenHash: string; expiresAt: Date }): Promise<StoredSession> {
    const session: StoredSession = { id: randomUUID(), userId: s.userId, tokenHash: s.tokenHash, expiresAt: s.expiresAt, revokedAt: null };
    this.sessions.push(session);
    return session;
  }

  async findSessionByHash(tokenHash: string): Promise<StoredSession | null> {
    return this.sessions.find((s) => s.tokenHash === tokenHash) ?? null;
  }

  async touchSession(id: string, tokenHash: string, expiresAt: Date): Promise<void> {
    const s = this.sessions.find((x) => x.id === id)!;
    s.tokenHash = tokenHash;
    s.expiresAt = expiresAt;
  }

  async revokeSession(id: string): Promise<void> {
    this.sessions.find((x) => x.id === id)!.revokedAt = new Date();
  }

  async audit(entry: { action: string; userId: string | null }): Promise<void> {
    this.auditLog.push({ action: entry.action, userId: entry.userId });
  }
}
