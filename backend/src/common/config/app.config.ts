import { registerAs } from '@nestjs/config';

export default registerAs('app', () => {
  // Validate required secrets at startup — app refuses to start if missing
  const required = [
    'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET',
    'PLATFORM_JWT_SECRET', 'FIELD_ENCRYPTION_KEY',
  ];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  const jwtSecret = (process.env.JWT_SECRET ?? '').trim();
  const platformJwtSecret = (process.env.PLATFORM_JWT_SECRET ?? '').trim();
  const fieldEncryptionKey = (process.env.FIELD_ENCRYPTION_KEY ?? '').trim();
  const redisUrl = (process.env.REDIS_URL ?? '').trim();
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters.');
  }
  if (platformJwtSecret === jwtSecret || platformJwtSecret.length < 32) {
    throw new Error('PLATFORM_JWT_SECRET must be a unique secret of at least 32 characters.');
  }
  if (!fieldEncryptionKey || fieldEncryptionKey.length < 32) {
    throw new Error('FIELD_ENCRYPTION_KEY must be at least 32 characters.');
  }
  try {
    const parsedRedisUrl = new URL(redisUrl);
    const redisPassword = decodeURIComponent(parsedRedisUrl.password);
    if (!['redis:', 'rediss:'].includes(parsedRedisUrl.protocol)
      || redisPassword.length < 32) {
      throw new Error();
    }
  } catch {
    throw new Error('REDIS_URL must use redis:// or rediss:// and include a password of at least 32 characters.');
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
  const frontendUrl = (process.env.APP_FRONTEND_URL ?? 'http://localhost:3000').trim();
  if (!frontendUrl) {
    throw new Error('APP_FRONTEND_URL cannot be blank.');
  }
  try {
    new URL(frontendUrl);
  } catch {
    throw new Error('APP_FRONTEND_URL must be a valid absolute URL.');
  }
  const objectStorageUrl = (process.env.OBJECT_STORAGE_URL ?? '').trim();
  const objectStorageAccessKey = (process.env.OBJECT_STORAGE_ACCESS_KEY ?? '').trim();
  const objectStorageSecretKey = (process.env.OBJECT_STORAGE_SECRET_KEY ?? '').trim();
  const objectStorageBucketPrivateProofs = (process.env.OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS ?? '').trim();
  if (objectStorageUrl || objectStorageAccessKey || objectStorageSecretKey || objectStorageBucketPrivateProofs) {
    if (!objectStorageUrl || !objectStorageAccessKey || !objectStorageSecretKey || !objectStorageBucketPrivateProofs) {
      throw new Error('OBJECT_STORAGE_URL, OBJECT_STORAGE_ACCESS_KEY, OBJECT_STORAGE_SECRET_KEY, and OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS must be configured together.');
    }
    if (process.env.NODE_ENV === 'production'
      && (!objectStorageUrl || !objectStorageAccessKey || !objectStorageSecretKey || !objectStorageBucketPrivateProofs)) {
      throw new Error('Private object storage must be fully configured in production.');
    }
    try {
      new URL(objectStorageUrl);
    } catch {
      throw new Error('OBJECT_STORAGE_URL must be a valid absolute URL.');
    }
    if (process.env.NODE_ENV === 'production' && !objectStorageUrl.startsWith('https://')) {
      throw new Error('OBJECT_STORAGE_URL must use HTTPS in production.');
    }
    if (objectStorageBucketPrivateProofs.includes(' ') || objectStorageBucketPrivateProofs.includes('/')) {
      throw new Error('OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS must be a bucket name without spaces or path separators.');
    }
  }
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
    jwtSecret,
    platformJwtSecret,
    jwtAccessExpiry: process.env.JWT_ACCESS_EXPIRY ?? '15m',
    jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY ?? '7d',
    fieldEncryptionKey,
    databaseUrl: process.env.DATABASE_URL!,
    redisUrl,
    emailProvider,
    emailApiKey: process.env.NOTIFICATION_EMAIL_API_KEY ?? '',
    emailFrom: process.env.NOTIFICATION_EMAIL_FROM ?? '',
    smsProvider,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    twilioFrom: process.env.TWILIO_FROM_NUMBER ?? '',
    frontendUrl,
    workerConcurrency,
    platformWorkerAdminEmail: process.env.PLATFORM_WORKER_ADMIN_EMAIL?.trim().toLowerCase() ?? '',
    databasePoolMax,
    loginMaxAttempts,
    loginLockoutMinutes,
    tenantMfaEnabled: process.env.TENANT_MFA_ENABLED !== 'false',
    objectStorageUrl,
    objectStorageAccessKey,
    objectStorageSecretKey,
    objectStorageRegion: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
    objectStorageSse: process.env.OBJECT_STORAGE_SSE ?? '',
    objectStorageAutoCreateBucket: process.env.OBJECT_STORAGE_AUTO_CREATE_BUCKET === 'true',
    objectStorageBucketPrivateProofs,
  };
});
