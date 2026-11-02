import * as crypto from 'crypto';

/**
 * Password hashing — bcrypt via Node crypto PBKDF2 fallback for environments
 * where bcrypt native bindings are unavailable.
 *
 * In production, install `bcrypt` or `argon2` and swap this implementation.
 * The interface is stable: hash() / verify() / isHashed().
 *
 * SRS V2 NFR-003: "Passwords shall be stored using a modern salted password-
 * hashing algorithm; plain-text password storage is prohibited."
 */

const ITERATIONS = 100_000;
const KEY_LEN = 64;
const DIGEST = 'sha512';
const SEPARATOR = ':';

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise<string>((resolve, reject) => {
    crypto.pbkdf2(plain, salt, ITERATIONS, KEY_LEN, DIGEST, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('hex'));
    });
  });
  return `pbkdf2${SEPARATOR}${ITERATIONS}${SEPARATOR}${salt}${SEPARATOR}${hash}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split(SEPARATOR);
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, iterStr, salt, storedHash] = parts;
  const iters = parseInt(iterStr, 10);
  const hash = await new Promise<string>((resolve, reject) => {
    crypto.pbkdf2(plain, salt, iters, KEY_LEN, DIGEST, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('hex'));
    });
  });
  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
}

export function isHashed(value: string): boolean {
  return value.startsWith('pbkdf2:');
}

/** SHA-256 hash for refresh/reset tokens stored in DB */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Generates a cryptographically secure random token */
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}
