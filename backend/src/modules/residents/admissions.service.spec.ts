import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdmissionsService } from './admissions.service';

describe('AdmissionsService', () => {
  let service: AdmissionsService;
  let prisma: any;
  let residents: { ensureBranch: jest.Mock; presentForAdmission: jest.Mock };
  let audit: { log: jest.Mock };

  beforeEach(() => {
    residents = {
      ensureBranch: jest.fn().mockResolvedValue(undefined),
      presentForAdmission: jest.fn((resident) => ({
        id: resident.id,
        cnicMasked: '*********5671',
      })),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      admission: { updateMany: jest.fn(), findFirst: jest.fn() },
      bed: { findMany: jest.fn() },
      bedAllocation: {},
      $transaction: jest.fn(),
    };
    service = new AdmissionsService(prisma, residents as any, audit as any);
  });

  it('requires a reason before rejecting an admission', async () => {
    await expect(
      service.decide('tenant-1', 'branch-1', 'user-1', 'admission-1', {
        decision: 'REJECTED',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.admission.updateMany).not.toHaveBeenCalled();
  });

  it('creates an admission only when the resident has no active admission', async () => {
    const created = {
      id: 'admission-1',
      resident: { id: 'resident-1', cnicEncrypted: 'encrypted' },
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'resident-1' }]),
      admission: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

    await expect(service.create('tenant-1', 'branch-1', 'user-1', {
      residentId: 'resident-1',
      notes: '  New admission  ',
    })).resolves.toEqual({
      id: 'admission-1',
      resident: { id: 'resident-1', cnicMasked: '*********5671' },
    });

    expect(tx.admission.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        branchId: 'branch-1',
        residentId: 'resident-1',
        status: { in: ['PENDING', 'APPROVED', 'CHECKED_IN'] },
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(tx.admission.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ notes: 'New admission' }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'admission.create',
      outcome: 'success',
    }));
  });

  it('rejects duplicate active admissions without creating or auditing another admission', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'resident-1' }]),
      admission: {
        findFirst: jest.fn().mockResolvedValue({ id: 'admission-existing' }),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

    await expect(service.create('tenant-1', 'branch-1', 'user-1', {
      residentId: 'resident-1',
    })).rejects.toThrow(ConflictException);

    expect(tx.admission.create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('checks in an approved admission and atomically occupies its bed', async () => {
    const admission = {
      id: 'admission-1',
      status: 'CHECKED_IN',
      resident: { id: 'resident-1', cnicEncrypted: 'encrypted' },
      allocations: [{ bedId: 'bed-1' }],
    };
    const tx = {
      bedAllocation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'allocation-1', bedId: 'bed-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bed: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      admission: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue(admission),
      },
    };
    tx.bedAllocation.findFirst.mockResolvedValue({
      id: 'allocation-1',
      bedId: 'bed-1',
      status: 'RESERVED',
      endedAt: null,
    });
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

    const result = await service.checkIn('tenant-1', 'branch-1', 'user-1', 'admission-1');

    expect(tx.bed.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'bed-1', status: 'RESERVED' }),
      data: { status: 'OCCUPIED' },
    }));
    expect(tx.admission.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'APPROVED' }),
      data: expect.objectContaining({ status: 'CHECKED_IN' }),
    }));
    expect(result.resident).toEqual({ id: 'resident-1', cnicMasked: '*********5671' });
    expect(result.resident).not.toHaveProperty('cnicEncrypted');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'admission.check_in',
      outcome: 'success',
    }));
  });

  it('rejects a bed assignment when the bed was taken concurrently', async () => {
    const tx = {
      admission: {
        findFirst: jest.fn().mockResolvedValue({ id: 'admission-1', residentId: 'resident-1' }),
      },
      bed: {
        findFirst: jest.fn().mockResolvedValue({ id: 'bed-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      bedAllocation: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

    await expect(
      service.allocateBed('tenant-1', 'branch-1', 'user-1', 'admission-1', 'bed-1'),
    ).rejects.toThrow(ConflictException);
    expect(tx.bedAllocation.create).not.toHaveBeenCalled();
  });
});
