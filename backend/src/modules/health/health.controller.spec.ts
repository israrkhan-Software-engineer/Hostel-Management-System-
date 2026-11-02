import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  const mockHealth = {
    check: jest.fn().mockResolvedValue({ status: 'ok', details: {} }),
  };
  const mockMemory = {
    checkHeap: jest.fn().mockResolvedValue({ memory_heap: { status: 'up' } }),
  };
  const mockDisk = {
    checkStorage: jest.fn().mockResolvedValue({ disk: { status: 'up' } }),
  };
  const mockPrisma = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new HealthController(
      mockHealth as any,
      mockMemory as any,
      mockDisk as any,
      mockPrisma as any,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('live() returns ok with valid ISO timestamp', () => {
    const result = controller.live();
    expect(result.status).toBe('ok');
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it('check() calls HealthCheckService.check', async () => {
    await controller.check();
    expect(mockHealth.check).toHaveBeenCalledTimes(1);
  });

  it('ready() calls HealthCheckService.check', async () => {
    await controller.ready();
    expect(mockHealth.check).toHaveBeenCalledTimes(1);
  });

  it('dbCheck passes when $queryRawUnsafe resolves', async () => {
    // Call check() which internally runs dbCheck via health.check callback
    // We verify the callback passed to health.check calls $queryRawUnsafe
    mockHealth.check.mockImplementationOnce(async (checks: (() => Promise<any>)[]) => {
      const result = await checks[0]();
      return { status: 'ok', details: result };
    });
    await controller.check();
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1');
  });

  it('dbCheck returns down when $queryRawUnsafe rejects', async () => {
    mockPrisma.$queryRawUnsafe.mockRejectedValueOnce(new Error('connection refused'));
    mockHealth.check.mockImplementationOnce(async (checks: (() => Promise<any>)[]) => {
      const result = await checks[0]();
      return result;
    });
    const result = await controller.check();
    expect((result as any).database?.status).toBe('down');
  });
});
