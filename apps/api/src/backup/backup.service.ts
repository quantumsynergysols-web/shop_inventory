import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { APP_CONFIG, type AppConfig } from '../config.js';

const run = promisify(execFile);
const DAY = 24 * 60 * 60_000;

export interface BackupFile {
  name: string;
  bytes: number;
  at: Date;
}

export interface BackupStatus {
  enabled: boolean;
  last: BackupFile | null;
  lastError: string | null;
  nextAt: string | null;
  keep: number;
}

/** pg_dump from PATH, or the default PostgreSQL install on Windows. */
export function findPgDump(configured: string): string {
  if (configured) return configured;
  if (process.platform === 'win32') {
    for (const v of ['18', '17', '16']) {
      const p = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\pg_dump.exe`;
      if (existsSync(p)) return p;
    }
  }
  return 'pg_dump';
}

/** Milliseconds until the next hh:00 in Pakistan time (UTC+5, no daylight saving). */
export function msUntilHour(hour: number, now = new Date()): number {
  const pk = new Date(now.getTime() + 5 * 3600_000);
  const next = Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), pk.getUTCDate(), hour) - 5 * 3600_000;
  return next > now.getTime() ? next - now.getTime() : next + DAY - now.getTime();
}

/**
 * FR-SET-05: daily automatic database backup. pg_dump (custom format, all shops) into BACKUP_DIR
 * at BACKUP_HOUR Pakistan time, keeping the newest BACKUP_KEEP files. A shop PC is often off at
 * night, so a backup also runs a minute after start when the newest one is more than a day old.
 * --enable-row-security: without app.shop_id the policies let every row through, so the dump is complete.
 * Restore: pg_restore --clean --if-exists --no-owner -d <database> <file>.
 */
@Injectable()
export class BackupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Backup');
  private timer: NodeJS.Timeout | null = null;
  private nextAt: Date | null = null;
  private lastError: string | null = null;
  private running: Promise<BackupFile> | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get dir(): string {
    return isAbsolute(this.config.BACKUP_DIR) ? this.config.BACKUP_DIR : join(process.cwd(), this.config.BACKUP_DIR);
  }

  onApplicationBootstrap(): void {
    if (!this.config.BACKUP_ENABLED) return;
    this.schedule(msUntilHour(this.config.BACKUP_HOUR));
    void this.list().then((files) => {
      const newest = files[0];
      if (!newest || Date.now() - newest.at.getTime() > DAY) this.schedule(60_000);
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.nextAt = new Date(Date.now() + ms);
    this.timer = setTimeout(() => {
      void this.backup()
        .catch(() => undefined)
        .finally(() => this.schedule(msUntilHour(this.config.BACKUP_HOUR)));
    }, ms);
    this.timer.unref();
  }

  async list(): Promise<BackupFile[]> {
    if (!existsSync(this.dir)) return [];
    const names = (await readdir(this.dir)).filter((n) => n.endsWith('.dump'));
    const files = await Promise.all(
      names.map(async (name) => {
        const s = await stat(join(this.dir, name));
        return { name, bytes: s.size, at: s.mtime };
      }),
    );
    return files.sort((a, b) => b.at.getTime() - a.at.getTime() || b.name.localeCompare(a.name));
  }

  async status(): Promise<BackupStatus> {
    return { enabled: this.config.BACKUP_ENABLED, last: (await this.list())[0] ?? null, lastError: this.lastError, nextAt: this.nextAt?.toISOString() ?? null, keep: this.config.BACKUP_KEEP };
  }

  /** One backup now; concurrent calls share the same run. */
  backup(): Promise<BackupFile> {
    this.running ??= this.dump().finally(() => (this.running = null));
    return this.running;
  }

  private async dump(): Promise<BackupFile> {
    const url = new URL(this.config.DATABASE_URL);
    const password = decodeURIComponent(url.password);
    const db = url.pathname.slice(1);
    // Password through the environment, not the command line (other users can see process arguments)
    url.password = '';
    url.search = '';
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const name = `${db}-${stamp}.dump`;
    const tmp = join(this.dir, `${name}.partial`);
    try {
      await mkdir(this.dir, { recursive: true });
      await run(findPgDump(this.config.PG_DUMP), ['--format=custom', '--no-owner', '--enable-row-security', `--file=${tmp}`, `--dbname=${url.toString()}`], {
        env: { ...process.env, PGPASSWORD: password },
        timeout: 30 * 60_000,
        windowsHide: true,
      });
      await rename(tmp, join(this.dir, name));
      const files = await this.list();
      for (const old of files.slice(this.config.BACKUP_KEEP)) await rm(join(this.dir, old.name), { force: true });
      this.lastError = null;
      const made = files.find((f) => f.name === name)!;
      this.log.log(`backup ${name} (${Math.round(made.bytes / 1024)} KB)`);
      return made;
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => undefined);
      // Never log the URL or password: keep only pg_dump's own message
      this.lastError = String((e as { stderr?: string }).stderr || (e as Error).message).replaceAll(password || '\u0000', '***').slice(0, 300);
      this.log.error(`backup failed: ${this.lastError}`);
      throw e;
    }
  }
}
