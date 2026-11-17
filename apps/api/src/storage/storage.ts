import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config.js';

/**
 * Where bill photos and receipt files live (FR-SCAN-08: every photo is kept as proof).
 * Local disk in development; an S3/R2 implementation replaces it in production.
 */
export interface FileStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

@Injectable()
export class LocalDiskStorage implements FileStorage {
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.root = resolve(isAbsolute(config.STORAGE_DIR) ? config.STORAGE_DIR : join(process.cwd(), config.STORAGE_DIR));
  }

  private path(key: string): string {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..')) throw new RangeError(`bad storage key ${key}`);
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new RangeError(`bad storage key ${key}`);
    return p;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
}
