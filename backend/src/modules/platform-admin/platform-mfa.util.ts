import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_MS = 30_000;

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => randomBytes(8).toString('hex').toUpperCase());
}

export function recoveryCodeHash(code: string): string {
  return createHash('sha256').update(code.replace(/[-\s]/g, '').toUpperCase()).digest('hex');
}

export function verifyTotp(secret: string, value: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(value)) return false;
  const key = decodeBase32(secret);
  const counter = Math.floor(now / TOTP_STEP_MS);
  for (const offset of [-1, 0, 1]) {
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter + offset));
    const digest = createHmac('sha1', key).update(message).digest();
    const index = digest[digest.length - 1] & 0x0f;
    const binary = digest.readUInt32BE(index) & 0x7fffffff;
    const expected = String(binary % 1_000_000).padStart(6, '0');
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(value))) return true;
  }
  return false;
}

export function authenticatorUri(secret: string, email: string, issuer = 'HMS Platform'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${query.toString()}`;
}

function encodeBase32(value: Buffer): string {
  let buffer = 0;
  let bits = 0;
  let result = '';
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += BASE32[(buffer << (5 - bits)) & 31];
  return result;
}

function decodeBase32(value: string): Buffer {
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of value.toUpperCase().replace(/=+$/g, '')) {
    const digit = BASE32.indexOf(character);
    if (digit < 0) throw new Error('Invalid TOTP secret');
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}