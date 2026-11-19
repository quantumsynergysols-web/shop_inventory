import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { del, get, put } from '@vercel/blob';
import { APP_CONFIG, type AppConfig } from '../config.js';

/**
 * Where bill photos and receipt files live (FR-SCAN-08: every photo is kept as proof).
 * Local disk in development; an S3/R2 implementation replaces it in production.
 */
export interface FileStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** FR-AI-16: photos older than the shop's retention period are removed */
  delete(key: string): Promise<void>;
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

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/**
 * Vercel Blob (private store) for serverless hosting, where the local disk does not survive between
 * requests. Photos are private: they are read back by the API with the store token, never by URL.
 */
export class VercelBlobStorage implements FileStorage {
  constructor(private readonly token: string) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await put(key, Buffer.from(bytes), { access: 'private', addRandomSuffix: false, allowOverwrite: true, token: this.token });
  }

  async get(key: string): Promise<Buffer> {
    const r = await get(key, { access: 'private', token: this.token });
    if (!r || r.statusCode !== 200) throw Object.assign(new Error(`file not found: ${key}`), { code: 'ENOENT' });
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await del(key, { token: this.token });
  }
}

/** Local disk by default; Vercel Blob when STORAGE_DRIVER=blob. */
export function storageFor(config: AppConfig): FileStorage {
  if (config.STORAGE_DRIVER === 'blob') {
    if (!config.BLOB_READ_WRITE_TOKEN) throw new Error('STORAGE_DRIVER=blob needs BLOB_READ_WRITE_TOKEN');
    return new VercelBlobStorage(config.BLOB_READ_WRITE_TOKEN);
  }
  return new LocalDiskStorage(config);
}
