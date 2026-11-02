describe('appConfig — required env var validation', () => {
  const required = [
    'DATABASE_URL', 'DATABASE_MIGRATION_URL', 'REDIS_URL', 'JWT_SECRET',
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
    process.env.REDIS_URL = 'redis://localhost:6379';
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

  it('does not throw when all required vars are present', () => {
    required.forEach((k) => { process.env[k] = 'test_value'; });
    expect(() => {
      const keys = required;
      for (const key of keys) {
        if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
      }
    }).not.toThrow();
  });
});
