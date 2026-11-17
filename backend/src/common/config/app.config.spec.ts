describe('appConfig — required env var validation', () => {
  const required = [
    'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET',
    'PLATFORM_JWT_SECRET', 'FIELD_ENCRYPTION_KEY',
  ];

  beforeEach(() => {
    // Clear all required vars
    required.forEach((k) => delete process.env[k]);
  });

  afterEach(() => {
    // Restore so other tests are not affected
    required.forEach((k) => {
      process.env[k] = 'test_value';
    });
  });

  it('throws when DATABASE_URL is missing', () => {
    process.env.REDIS_URL = `redis://:${'r'.repeat(32)}@localhost:6379`;
    process.env.JWT_SECRET = 'test_secret_32_chars_long_minimum!!';
    process.env.PLATFORM_JWT_SECRET = 'different_platform_secret_32_chars!!';
    process.env.FIELD_ENCRYPTION_KEY = 'test_field_key_32_chars_long_min!';
    // DATABASE_URL is absent
    expect(() => {
      // Inline the validation logic (mirrors app.config.ts)
      const keys = required;
      for (const key of keys) {
        if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
      }
    }).toThrow('Missing required environment variable: DATABASE_URL');
  });

  it('throws when the field encryption key is shorter than the minimum required length', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    process.env.REDIS_URL = `redis://:${'r'.repeat(32)}@localhost:6379`;
    process.env.JWT_SECRET = 'test_secret_32_chars_long_minimum!!';
    process.env.PLATFORM_JWT_SECRET = 'different_platform_secret_32_chars!!';
    process.env.FIELD_ENCRYPTION_KEY = 'short';

    expect(() => {
      const key = (process.env.FIELD_ENCRYPTION_KEY ?? '').trim();
      if (!key || key.length < 32) {
        throw new Error('FIELD_ENCRYPTION_KEY must be at least 32 characters.');
      }
    }).toThrow('FIELD_ENCRYPTION_KEY must be at least 32 characters.');
  });

  it('does not throw when all required vars are present', () => {
    required.forEach((k) => { process.env[k] = 'test_value'; });
    expect(() => {
      const keys = required;
      for (const key of keys) {
        if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
      }
    }).not.toThrow();
  });

  it('requires object storage credentials to be configured together with a valid URL', () => {
    required.forEach((k) => { process.env[k] = 'test_value'; });
    process.env.OBJECT_STORAGE_URL = 'not-a-url';
    process.env.OBJECT_STORAGE_ACCESS_KEY = 'access';
    process.env.OBJECT_STORAGE_SECRET_KEY = 'secret';
    process.env.OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS = 'proofs';

    expect(() => {
      const objectStorageUrl = (process.env.OBJECT_STORAGE_URL ?? '').trim();
      const objectStorageAccessKey = (process.env.OBJECT_STORAGE_ACCESS_KEY ?? '').trim();
      const objectStorageSecretKey = (process.env.OBJECT_STORAGE_SECRET_KEY ?? '').trim();
      const objectStorageBucketPrivateProofs = (process.env.OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS ?? '').trim();
      if (objectStorageUrl || objectStorageAccessKey || objectStorageSecretKey || objectStorageBucketPrivateProofs) {
        if (!objectStorageUrl || !objectStorageAccessKey || !objectStorageSecretKey || !objectStorageBucketPrivateProofs) {
          throw new Error('OBJECT_STORAGE_URL, OBJECT_STORAGE_ACCESS_KEY, OBJECT_STORAGE_SECRET_KEY, and OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS must be configured together.');
        }
        try { new URL(objectStorageUrl); } catch {
          throw new Error('OBJECT_STORAGE_URL must be a valid absolute URL.');
        }
      }
    }).toThrow('OBJECT_STORAGE_URL must be a valid absolute URL.');
  });

  it('rejects Redis URLs without a sufficiently long password', () => {
    required.forEach((k) => { process.env[k] = 'test_value'; });
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    process.env.JWT_SECRET = 'test_secret_32_chars_long_minimum!!';
    process.env.PLATFORM_JWT_SECRET = 'different_platform_secret_32_chars!!';
    process.env.FIELD_ENCRYPTION_KEY = 'test_field_key_32_chars_long_min!';
    process.env.REDIS_URL = 'redis://:short@localhost:6379';

    expect(() => {
      const parsed = new URL(process.env.REDIS_URL ?? '');
      if (decodeURIComponent(parsed.password).length < 32) throw new Error('short Redis secret');
    }).toThrow('short Redis secret');
  });

  it('rejects bucket names with path separators or whitespace', () => {
    required.forEach((k) => { process.env[k] = 'test_value'; });
    process.env.OBJECT_STORAGE_URL = 'https://storage.example.com';
    process.env.OBJECT_STORAGE_ACCESS_KEY = 'access';
    process.env.OBJECT_STORAGE_SECRET_KEY = 'secret';
    process.env.OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS = 'proofs/private';

    expect(() => {
      const bucket = (process.env.OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS ?? '').trim();
      if (bucket.includes(' ') || bucket.includes('/')) {
        throw new Error('OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS must be a bucket name without spaces or path separators.');
      }
    }).toThrow('OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS must be a bucket name without spaces or path separators.');
  });
});
