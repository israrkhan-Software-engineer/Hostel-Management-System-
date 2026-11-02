import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptField(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptField(value: string, secret: string): string {
  const [version, iv, tag, ciphertext] = value.split(':');
  if (version !== 'v1' || !iv || !tag || ciphertext === undefined) {
    throw new Error('Unsupported encrypted field format');
  }

  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function fingerprintField(value: string, secret: string): string {
  return createHmac('sha256', deriveKey(secret)).update(value, 'utf8').digest('hex');
}

export function maskIdentityNumber(value: string): string {
  return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}
