import { createHmac } from 'node:crypto';
import { generateRecoveryCodes, generateTotpSecret, recoveryCodeHash, verifyTotp } from './platform-mfa.util';

describe('platform MFA utilities', () => {
  it('accepts valid RFC 6238 codes within the clock-skew window only', () => {
    const secret = generateTotpSecret();
    const now = 1_798_000_000_000;
    const key = decodeBase32ForTest(secret);
    const counter = Math.floor(now / 30_000);
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac('sha1', key).update(message).digest();
    const index = digest[digest.length - 1] & 0x0f;
    const code = String((digest.readUInt32BE(index) & 0x7fffffff) % 1_000_000).padStart(6, '0');

    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, code, now + 120_000)).toBe(false);
    expect(verifyTotp(secret, '12345', now)).toBe(false);
  });

  it('generates unique high-entropy recovery codes and normalizes their hashes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((code) => /^[A-F0-9]{16}$/.test(code))).toBe(true);
    expect(recoveryCodeHash(codes[0])).toBe(recoveryCodeHash(` ${codes[0].slice(0, 8)}-${codes[0].slice(8)} `));
  });
});

function decodeBase32ForTest(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of value) {
    accumulator = (accumulator << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}