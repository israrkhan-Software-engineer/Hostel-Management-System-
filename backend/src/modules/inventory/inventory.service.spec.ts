import { ConflictException } from '@nestjs/common';
import { validate } from 'class-validator';
import { CreateRoomDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;
  let prisma: any;
  let audit: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
      building: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
      floor: { create: jest.fn(), findFirst: jest.fn() },
      room: { create: jest.fn(), findMany: jest.fn() },
      bed: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new InventoryService(prisma, audit as any);
  });

  it('accepts room capacities from 1 through 10 and rejects invalid values', async () => {
    const validateCapacity = async (bedCapacity: number) => validate(
      Object.assign(new CreateRoomDto(), {
        floorId: '550e8400-e29b-41d4-a716-446655440000',
        code: 'A1',
        bedCapacity,
      }),
    );

    expect(await validateCapacity(1)).toHaveLength(0);
    expect(await validateCapacity(10)).toHaveLength(0);
    expect(await validateCapacity(0)).not.toHaveLength(0);
    expect(await validateCapacity(11)).not.toHaveLength(0);
    expect(await validateCapacity(1.5)).not.toHaveLength(0);
  });

  it('creates a bed when the room has capacity', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'room-1' }]),
      room: { findFirst: jest.fn().mockResolvedValue({ id: 'room-1', bedCapacity: 2 }) },
      bed: {
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue({ id: 'bed-1', code: 'A' }),
      },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

    const result = await service.createBed(
      'tenant-1',
      'branch-1',
      'user-1',
      { roomId: 'room-1', code: 'A' },
    );

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.bed.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { tenantId: 'tenant-1', branchId: 'branch-1', roomId: 'room-1', code: 'A' },
    }));
    expect(result).toEqual({ id: 'bed-1', code: 'A' });
  });

  it('prevents creating beds beyond room capacity', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'room-1' }]),
      room: { findFirst: jest.fn().mockResolvedValue({ id: 'room-1', bedCapacity: 1 }) },
      bed: { count: jest.fn().mockResolvedValue(1), create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

    await expect(
      service.createBed('tenant-1', 'branch-1', 'user-1', {
        roomId: 'room-1',
        code: 'B',
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.bed.create).not.toHaveBeenCalled();
  });
});
