jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ close: jest.fn(), add: jest.fn() })),
}));

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    quit: jest.fn(),
  })),
}));

import { NotificationsService } from './notifications.service';
import { Queue } from 'bullmq';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: any;
  let config: any;

  beforeEach(() => {
    prisma = {
      notification: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    config = { getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379') };
    service = new NotificationsService(prisma as any, config as any);
  });

  it('paginates notifications and exposes total count metadata', async () => {
    prisma.notification.findMany.mockResolvedValue([{ id: 'n-1' }, { id: 'n-2' }]);
    prisma.notification.count.mockResolvedValue(4);

    await expect(service.list('tenant-1', 'user-1', false, 2, 2)).resolves.toEqual({
      items: [{ id: 'n-1' }, { id: 'n-2' }],
      page: 2,
      pageSize: 2,
      total: 4,
      pageCount: 2,
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', userId: 'user-1' },
      skip: 2,
      take: 2,
      orderBy: { createdAt: 'desc' },
    }));
    expect(prisma.notification.count).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', userId: 'user-1' },
    }));
  });

  it('cap limits excessive page sizes to the supported maximum', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);

    await service.list('tenant-1', 'user-1', true, 1, 999);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 100,
    }));
  });

  it('namespaces queued delivery job IDs by tenant', async () => {
    const queues = jest.mocked(Queue).mock.results;
    const queue = queues[queues.length - 1].value;
    await service.enqueueDelivery({ kind: 'email', to: 'a@example.test', text: 'message' }, 'tenant-1', 'same-key');
    await service.enqueueDelivery({ kind: 'email', to: 'b@example.test', text: 'message' }, 'tenant-2', 'same-key');

    expect(queue.add).toHaveBeenNthCalledWith(1, 'deliver', expect.any(Object), expect.objectContaining({
      jobId: expect.stringMatching(/^tenant-1-/),
    }));
    expect(queue.add).toHaveBeenNthCalledWith(2, 'deliver', expect.any(Object), expect.objectContaining({
      jobId: expect.stringMatching(/^tenant-2-/),
    }));
  });
});
