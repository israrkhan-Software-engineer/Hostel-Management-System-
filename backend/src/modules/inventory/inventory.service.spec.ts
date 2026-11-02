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
      room: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), findFirstOrThrow: jest.fn(), updateMany: jest.fn() },
      bed: { findMany: jest.fn(), count: jest.fn() },
      bedAllocation: { findFirst: jest.fn() },
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

  it('does not reduce room capacity below active bed count', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'room-1' }]),
      room: {
        findFirst: jest.fn().mockResolvedValue({ id: 'room-1' }),
        updateMany: jest.fn(),
      },
      bed: { count: jest.fn().mockResolvedValue(3) },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

    await expect(service.updateRoom('tenant-1', 'branch-1', 'user-1', 'room-1', {
      bedCapacity: 2,
    })).rejects.toThrow(ConflictException);
    expect(tx.room.updateMany).not.toHaveBeenCalled();
  });

  it('archives a room only after all active beds have been archived', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'room-1' }]),
      room: { findFirst: jest.fn().mockResolvedValue({ id: 'room-1' }), updateMany: jest.fn() },
      bed: { count: jest.fn().mockResolvedValue(1) },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

    await expect(service.archiveRoom('tenant-1', 'branch-1', 'user-1', 'room-1'))
      .rejects.toThrow(ConflictException);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.room.updateMany).not.toHaveBeenCalled();
  });

  it('archives a room atomically after its active beds are gone', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'room-1' }]),
      room: {
        findFirst: jest.fn().mockResolvedValue({ id: 'room-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bed: { count: jest.fn().mockResolvedValue(0) },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

    await expect(service.archiveRoom('tenant-1', 'branch-1', 'user-1', 'room-1'))
      .resolves.toEqual(expect.objectContaining({ id: 'room-1', deletedAt: expect.any(Date) }));
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.room.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'room-1', tenantId: 'tenant-1', branchId: 'branch-1', deletedAt: null },
    }));
    expect(audit.log).toHaveBeenCalled();
  });

  it('refuses to archive occupied beds', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'bed-1' }]),
      bed: { findFirst: jest.fn().mockResolvedValue({ id: 'bed-1', status: 'OCCUPIED' }), updateMany: jest.fn() },
      bedAllocation: { findFirst: jest.fn() },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

    await expect(service.archiveBed('tenant-1', 'branch-1', 'user-1', 'bed-1'))
      .rejects.toThrow(ConflictException);
    expect(tx.bedAllocation.findFirst).not.toHaveBeenCalled();
    expect(tx.bed.updateMany).not.toHaveBeenCalled();
  });
});
