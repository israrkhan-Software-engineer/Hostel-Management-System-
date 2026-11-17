export function assertSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const nodeEnv = (env.NODE_ENV ?? '').trim().toLowerCase();
  const allowSeed = (env.ALLOW_SEED ?? '').trim().toLowerCase() === 'true';

  if (nodeEnv === 'production' && !allowSeed) {
    throw new Error('Seed scripts are disabled in production. Set ALLOW_SEED=true to allow a one-off seed run.');
  }
}

export function isWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = (env.NODE_ENV ?? '').trim().toLowerCase();
  const explicitFlag = (env.HMS_ENABLE_WORKER ?? '').trim().toLowerCase();

  if (explicitFlag === 'true') return true;
  if (explicitFlag === 'false') return false;
  return nodeEnv !== 'production';
}
