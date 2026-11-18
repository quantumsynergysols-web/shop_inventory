import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * NFR-SEC-01 / FR-SET-02: a shop's own AI key is stored AES-256-GCM encrypted (iv | tag | ciphertext)
 * with a key derived from AI_KEY_SECRET, and is never sent back to the browser.
 */
const keyFrom = (secret: string) => createHash('sha256').update(`erp-ai-key:${secret}`).digest();

export function encryptKey(plain: string, secret: string): Buffer {
  if (!secret) throw new Error('AI_KEY_SECRET is not set on the server, so a shop key cannot be stored');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function decryptKey(blob: Uint8Array, secret: string): string {
  const b = Buffer.from(blob);
  const d = createDecipheriv('aes-256-gcm', keyFrom(secret), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
