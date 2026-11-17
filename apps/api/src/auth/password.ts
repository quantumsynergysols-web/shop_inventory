import { hash, verify } from '@node-rs/argon2';

/** NFR-SEC-01: passwords are hashed with Argon2id. */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

/**
 * Hash of a random password, used so that a login for an unknown phone/email
 * takes as long as a login with a wrong password (no account enumeration by timing).
 */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hash('not-a-real-password-' + Math.random());
  return dummy;
}
