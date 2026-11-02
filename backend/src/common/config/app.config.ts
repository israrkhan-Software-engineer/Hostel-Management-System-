import { registerAs } from '@nestjs/config';

export default registerAs('app', () => {
  // Validate required secrets at startup — app refuses to start if missing
  const required = [
    'DATABASE_URL', 'DATABASE_MIGRATION_URL', 'REDIS_URL', 'JWT_SECRET',
    'PLATFORM_JWT_SECRET', 'FIELD_ENCRYPTION_KEY',
  ];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  if (process.env.PLATFORM_JWT_SECRET === process.env.JWT_SECRET
    || (process.env.PLATFORM_JWT_SECRET?.length ?? 0) < 32) {
    throw new Error('PLATFORM_JWT_SECRET must be a unique secret of at least 32 characters.');
  }

  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3001', 10),
    // proposed defaults pending G-04/OD-08 owner approval
    timezone: process.env.APP_TIMEZONE ?? 'Asia/Karachi',
    currency: process.env.APP_DEFAULT_CURRENCY ?? 'PKR',
    jwtSecret: process.env.JWT_SECRET!,
    platformJwtSecret: process.env.PLATFORM_JWT_SECRET!,
    jwtAccessExpiry: process.env.JWT_ACCESS_EXPIRY ?? '15m',
    jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY ?? '7d',
    fieldEncryptionKey: process.env.FIELD_ENCRYPTION_KEY!,
    databaseUrl: process.env.DATABASE_URL!,
    databaseMigrationUrl: process.env.DATABASE_MIGRATION_URL!,
    redisUrl: process.env.REDIS_URL!,
  };
});
