import * as crypto from 'crypto';

const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 3;
const SCRYPT_KEY_LEN = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const PBKDF2_MIN_ITERATIONS = 100_000;
const PBKDF2_MAX_ITERATIONS = 1_000_000;
const SEPARATOR = ':';

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await deriveScrypt(plain, salt, SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELIZATION);
  return `scrypt${SEPARATOR}${SCRYPT_COST}${SEPARATOR}${SCRYPT_BLOCK_SIZE}${SEPARATOR}${SCRYPT_PARALLELIZATION}${SEPARATOR}${salt}${SEPARATOR}${key.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split(SEPARATOR);
  if (parts[0] === 'scrypt' && parts.length === 6) {
    const [, costValue, blockSizeValue, parallelizationValue, salt, storedHash] = parts;
    const cost = Number(costValue);
    const blockSize = Number(blockSizeValue);
    const parallelization = Number(parallelizationValue);
    if (
      !Number.isSafeInteger(cost) || cost < 16_384 || cost > 65_536
      || (cost & (cost - 1)) !== 0
      || !Number.isSafeInteger(blockSize) || blockSize < 1 || blockSize > 16
      || !Number.isSafeInteger(parallelization) || parallelization < 1 || parallelization > 4
      || !/^[a-f0-9]{32}$/i.test(salt)
      || !/^[a-f0-9]{128}$/i.test(storedHash)
    ) {
      return false;
    }

    const hash = await deriveScrypt(plain, salt, cost, blockSize, parallelization);
    return crypto.timingSafeEqual(hash, Buffer.from(storedHash, 'hex'));
  }

  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, iterStr, salt, storedHash] = parts;
  const iterations = Number(iterStr);
  if (
    !Number.isSafeInteger(iterations)
    || iterations < PBKDF2_MIN_ITERATIONS
    || iterations > PBKDF2_MAX_ITERATIONS
    || !/^[a-f0-9]{32}$/i.test(salt)
    || !/^[a-f0-9]{128}$/i.test(storedHash)
  ) {
    return false;
  }
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(plain, salt, iterations, SCRYPT_KEY_LEN, 'sha512', (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return crypto.timingSafeEqual(hash, Buffer.from(storedHash, 'hex'));
}

export function isHashed(value: string): boolean {
  return value.startsWith('scrypt:') || value.startsWith('pbkdf2:');
}

export function needsPasswordRehash(value: string): boolean {
  return !value.startsWith(
    `scrypt:${SCRYPT_COST}:${SCRYPT_BLOCK_SIZE}:${SCRYPT_PARALLELIZATION}:`,
  );
}

/** SHA-256 hash for refresh/reset tokens stored in DB */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Generates a cryptographically secure random token */
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function deriveScrypt(
  plain: string,
  salt: string,
  cost: number,
  blockSize: number,
  parallelization: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      plain,
      Buffer.from(salt, 'hex'),
      SCRYPT_KEY_LEN,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}
