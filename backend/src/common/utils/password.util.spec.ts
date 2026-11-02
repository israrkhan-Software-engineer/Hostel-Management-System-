import { hashPassword, verifyPassword, isHashed, hashToken, generateToken } from './password.util';

describe('password.util', () => {
  describe('hashPassword / verifyPassword', () => {
    it('hashes a password and verifies it correctly', async () => {
      const hash = await hashPassword('MyS3cur3Pass!');
      expect(isHashed(hash)).toBe(true);
      expect(await verifyPassword('MyS3cur3Pass!', hash)).toBe(true);
    });

    it('rejects wrong password', async () => {
      const hash = await hashPassword('correct');
      expect(await verifyPassword('wrong', hash)).toBe(false);
    });

    it('never stores plain text', async () => {
      const hash = await hashPassword('secret');
      expect(hash).not.toContain('secret');
    });

    it('produces different hashes for same input (random salt)', async () => {
      const h1 = await hashPassword('same');
      const h2 = await hashPassword('same');
      expect(h1).not.toBe(h2);
    });

    it('returns false for malformed stored hash', async () => {
      expect(await verifyPassword('x', 'notahash')).toBe(false);
    });
  });

  describe('hashToken', () => {
    it('returns a 64-char hex string', () => {
      const h = hashToken('some-token');
      expect(h).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(h)).toBe(true);
    });

    it('is deterministic', () => {
      expect(hashToken('abc')).toBe(hashToken('abc'));
    });

    it('different inputs produce different hashes', () => {
      expect(hashToken('a')).not.toBe(hashToken('b'));
    });
  });

  describe('generateToken', () => {
    it('returns hex string of correct length', () => {
      const t = generateToken(32);
      expect(t).toHaveLength(64); // 32 bytes → 64 hex chars
    });

    it('generates unique tokens', () => {
      expect(generateToken()).not.toBe(generateToken());
    });
  });
});
