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
  const loginMaxAttempts = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS ?? '5');
  const loginLockoutMinutes = Number(process.env.AUTH_LOGIN_LOCKOUT_MINUTES ?? '15');
  const workerConcurrency = Number(process.env.WORKER_CONCURRENCY ?? '4');
  const databasePoolMax = Number(process.env.DATABASE_POOL_MAX ?? '10');
  if (!Number.isSafeInteger(loginMaxAttempts) || loginMaxAttempts < 1
    || !Number.isSafeInteger(loginLockoutMinutes) || loginLockoutMinutes < 1
    || !Number.isSafeInteger(workerConcurrency) || workerConcurrency < 1
    || !Number.isSafeInteger(databasePoolMax) || databasePoolMax < 1) {
    throw new Error('AUTH_LOGIN_MAX_ATTEMPTS, AUTH_LOGIN_LOCKOUT_MINUTES, WORKER_CONCURRENCY, and DATABASE_POOL_MAX must be positive integers.');
  }
  const emailProvider = process.env.NOTIFICATION_EMAIL_PROVIDER ?? '';
  const smsProvider = process.env.NOTIFICATION_SMS_PROVIDER ?? '';
  if (emailProvider && emailProvider !== 'resend') {
    throw new Error('NOTIFICATION_EMAIL_PROVIDER must be resend or blank.');
  }
  if (emailProvider === 'resend'
    && (!process.env.NOTIFICATION_EMAIL_API_KEY || !process.env.NOTIFICATION_EMAIL_FROM)) {
    throw new Error('Resend email delivery requires NOTIFICATION_EMAIL_API_KEY and NOTIFICATION_EMAIL_FROM.');
  }
  if (smsProvider && smsProvider !== 'twilio') {
    throw new Error('NOTIFICATION_SMS_PROVIDER must be twilio or blank.');
  }
  if (smsProvider === 'twilio'
    && (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER)) {
    throw new Error('Twilio SMS delivery requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.');
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
    emailProvider,
    emailApiKey: process.env.NOTIFICATION_EMAIL_API_KEY ?? '',
    emailFrom: process.env.NOTIFICATION_EMAIL_FROM ?? '',
    smsProvider,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    twilioFrom: process.env.TWILIO_FROM_NUMBER ?? '',
    frontendUrl: process.env.APP_FRONTEND_URL ?? 'http://localhost:3000',
    workerConcurrency,
    platformWorkerAdminEmail: process.env.PLATFORM_WORKER_ADMIN_EMAIL?.trim().toLowerCase() ?? '',
    databasePoolMax,
    loginMaxAttempts,
    loginLockoutMinutes,
    tenantMfaEnabled: process.env.TENANT_MFA_ENABLED !== 'false',
    objectStorageUrl: process.env.OBJECT_STORAGE_URL ?? '',
    objectStorageAccessKey: process.env.OBJECT_STORAGE_ACCESS_KEY ?? '',
    objectStorageSecretKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? '',
    objectStorageRegion: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
    objectStorageSse: process.env.OBJECT_STORAGE_SSE ?? '',
    objectStorageAutoCreateBucket: process.env.OBJECT_STORAGE_AUTO_CREATE_BUCKET === 'true',
    objectStorageBucketPrivateProofs: process.env.OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS ?? '',
  };
});
