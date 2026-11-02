import {
  decryptField,
  encryptField,
  fingerprintField,
  maskIdentityNumber,
} from './field-encryption.util';

describe('field-encryption.util', () => {
  const key = 'test-field-encryption-key';
  const cnic = '1234512345671';

  it('encrypts sensitive values and decrypts them only with the same key', () => {
    const encrypted = encryptField(cnic, key);

    expect(encrypted).not.toContain(cnic);
    expect(decryptField(encrypted, key)).toBe(cnic);
    expect(() => decryptField(encrypted, 'different-key')).toThrow();
  });

  it('uses a fresh nonce for each encryption', () => {
    expect(encryptField(cnic, key)).not.toBe(encryptField(cnic, key));
  });

  it('creates a stable keyed fingerprint and masks the identifier', () => {
    expect(fingerprintField(cnic, key)).toBe(fingerprintField(cnic, key));
    expect(fingerprintField(cnic, key)).not.toBe(fingerprintField(cnic, 'different-key'));
    expect(maskIdentityNumber(cnic)).toBe('*********5671');
  });

  it('rejects altered ciphertext', () => {
    const [version, iv, tag, ciphertext] = encryptField(cnic, key).split(':');
    const changed = `${version}:${iv}:${tag}:${ciphertext.slice(0, -2)}AA`;

    expect(() => decryptField(changed, key)).toThrow();
  });
});
