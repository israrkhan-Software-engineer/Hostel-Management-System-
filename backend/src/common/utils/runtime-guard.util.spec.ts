import { assertSeedAllowed, isWorkerEnabled } from './runtime-guard.util';

describe('runtime guard utilities', () => {
  it('blocks production seeds unless explicitly allowed', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production' })).toThrow(
      'Seed scripts are disabled in production. Set ALLOW_SEED=true to allow a one-off seed run.',
    );

    expect(() => assertSeedAllowed({ NODE_ENV: 'production', ALLOW_SEED: 'true' })).not.toThrow();
  });

  it('allows local workers by default while requiring an explicit production opt-in', () => {
    expect(isWorkerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(isWorkerEnabled({ NODE_ENV: 'test' })).toBe(true);
    expect(isWorkerEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(isWorkerEnabled({ NODE_ENV: 'production', HMS_ENABLE_WORKER: 'true' })).toBe(true);
    expect(isWorkerEnabled({ NODE_ENV: 'production', HMS_ENABLE_WORKER: 'false' })).toBe(false);
  });
});
