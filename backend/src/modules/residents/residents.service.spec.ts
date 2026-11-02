import { ConflictException } from '@nestjs/common';
import { validate } from 'class-validator';
import {
  CreateResidentDto,
  UpdateMyResidentProfileDto,
  UpdateResidentDto,
} from './residents.dto';
import { ResidentsService } from './residents.service';
import { decryptField, fingerprintField } from '../../common/utils/field-encryption.util';

describe('ResidentsService', () => {
  const key = 'unit-test-field-key';
  let service: ResidentsService;
  let prisma: any;
  let audit: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
      resident: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      user: { findFirst: jest.fn() },
      bedAllocation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new ResidentsService(
      prisma,
      audit as any,
      { getOrThrow: jest.fn().mockReturnValue(key) } as any,
    );
  });

  it('accepts Unicode names and rejects numeric-only names', async () => {
    const validResident = Object.assign(new CreateResidentDto(), {
      firstName: 'Élodie',
      lastName: "O'Neil-Smith",
    });
    const invalidResident = Object.assign(new CreateResidentDto(), {
      firstName: '12345',
      lastName: 'Khan',
    });

    expect(await validate(validResident)).toHaveLength(0);
    expect(await validate(invalidResident)).not.toHaveLength(0);
  });

  it('accepts future dates of birth while rejecting invalid calendar dates', async () => {
    const futureDate = '2999-01-01';
    const createDto = Object.assign(new CreateResidentDto(), {
      firstName: 'Amina',
      lastName: 'Khan',
      dateOfBirth: futureDate,
    });
    const updateDto = Object.assign(new UpdateResidentDto(), { dateOfBirth: futureDate });
    const selfUpdateDto = Object.assign(new UpdateMyResidentProfileDto(), {
      firstName: 'Amina',
      lastName: 'Khan',
      dateOfBirth: futureDate,
    });
    const invalidDateDto = Object.assign(new CreateResidentDto(), {
      firstName: 'Amina',
      lastName: 'Khan',
      dateOfBirth: '2024-02-30',
    });

    expect(await validate(createDto)).toHaveLength(0);
    expect(await validate(updateDto)).toHaveLength(0);
    expect(await validate(selfUpdateDto)).toHaveLength(0);
    expect(await validate(invalidDateDto)).not.toHaveLength(0);
  });

  it('encrypts CNIC, fingerprints it for deduplication, and only returns a mask', async () => {
    const now = new Date();
    const cnic = '12345-1234567-1';
    prisma.resident.create.mockImplementation(({ data }: any) => ({
      id: 'resident-1',
      ...data,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }));

    const result = await service.create('tenant-1', 'branch-1', 'user-1', {
      firstName: 'Amina',
      lastName: 'Khan',
      cnic,
    });

    const saved = prisma.resident.create.mock.calls[0][0].data;
    expect(saved.cnicEncrypted).not.toContain('1234512345671');
    expect(decryptField(saved.cnicEncrypted, key)).toBe('1234512345671');
    expect(saved.cnicFingerprint).toBe(
      fingerprintField('tenant-1:1234512345671', key),
    );
    expect(result.cnicMasked).toBe('*********5671');
    expect(result).not.toHaveProperty('cnicEncrypted');
    expect(result).not.toHaveProperty('cnicFingerprint');
    const auditPayload = audit.log.mock.calls[0][0];
    expect(auditPayload).not.toHaveProperty('cnic');
    expect(auditPayload).not.toHaveProperty('cnicEncrypted');
  });

  it('maps duplicate CNIC fingerprint errors to a conflict response', async () => {
    prisma.resident.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.create('tenant-1', 'branch-1', 'user-1', {
        firstName: 'Amina',
        lastName: 'Khan',
        cnic: '1234512345671',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('searches residents by exact ID and CNIC fingerprint without exposing CNIC', async () => {
    prisma.resident.findMany.mockResolvedValue([]);

    await service.list('tenant-1', 'branch-1', '12345-1234567-1');
    const searchQuery = prisma.resident.findMany.mock.calls[0][0].where.OR;
    expect(searchQuery).toContainEqual({
      cnicFingerprint: fingerprintField('tenant-1:1234512345671', key),
    });
    expect(JSON.stringify(searchQuery)).not.toContain('1234512345671');

    prisma.resident.findMany.mockClear();
    await service.list('tenant-1', 'branch-1', '550e8400-e29b-41d4-a716-446655440000');
    expect(prisma.resident.findMany.mock.calls[0][0].where.OR).toContainEqual({
      id: '550e8400-e29b-41d4-a716-446655440000',
    });
  });

  it('does not deactivate a resident who still has an active bed allocation', async () => {
    prisma.resident.findFirst.mockResolvedValue({ id: 'resident-1' });
    prisma.bedAllocation.findFirst.mockResolvedValue({ id: 'allocation-1' });

    await expect(
      service.deactivate('tenant-1', 'branch-1', 'user-1', 'resident-1'),
    ).rejects.toThrow(ConflictException);
    expect(prisma.resident.update).not.toHaveBeenCalled();
  });

  it('returns only the resident linked to the signed-in student', async () => {
    prisma.resident.findFirst.mockResolvedValue({
      id: 'resident-1',
      tenantId: 'tenant-1',
      branchId: 'branch-1',
      userId: 'student-1',
      firstName: 'Amina',
      lastName: 'Khan',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      allocations: [],
    });

    await service.getMyResident('tenant-1', 'branch-1', 'student-1');

    expect(prisma.resident.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', branchId: 'branch-1', userId: 'student-1', deletedAt: null },
      include: expect.objectContaining({
        allocations: expect.objectContaining({
          where: { endedAt: null, status: { in: ['RESERVED', 'CHECKED_IN'] } },
          take: 1,
        }),
      }),
    }));
  });

  it('returns the active room and bed allocation for the linked student', async () => {
    prisma.resident.findFirst.mockResolvedValue({
      id: 'resident-1',
      tenantId: 'tenant-1',
      branchId: 'branch-1',
      userId: 'student-1',
      firstName: 'Amina',
      lastName: 'Khan',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      allocations: [{
        status: 'CHECKED_IN',
        checkedInAt: new Date('2026-10-28T00:00:00.000Z'),
        bed: {
          code: 'A-1',
          room: {
            code: '101',
            floor: { name: 'Ground', level: 0, building: { name: 'North' } },
          },
        },
      }],
    });

    const resident = await service.getMyResident('tenant-1', 'branch-1', 'student-1');

    expect(resident.room).toMatchObject({
      building: 'North',
      floor: 'Ground',
      room: '101',
      bed: 'A-1',
      allocationStatus: 'CHECKED_IN',
    });
  });

  it('links only an active student account with the same tenant email', async () => {
    prisma.resident.findFirst.mockResolvedValue({
      id: 'resident-1',
      email: 'student@example.test',
      userId: null,
    });
    prisma.user.findFirst.mockResolvedValue({ id: 'student-1' });
    prisma.resident.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.linkAccountByEmail('tenant-1', 'branch-1', 'staff-1', 'resident-1'),
    ).resolves.toEqual({ linked: true });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        email: { equals: 'student@example.test', mode: 'insensitive' },
        status: 'ACTIVE',
        deletedAt: null,
        userRoles: {
          some: { tenantId: 'tenant-1', role: { name: 'Resident', deletedAt: null } },
        },
      },
      select: { id: true },
    });
    expect(prisma.resident.updateMany).toHaveBeenCalledWith({
      where: { id: 'resident-1', tenantId: 'tenant-1', branchId: 'branch-1', userId: null },
      data: { userId: 'student-1' },
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'resident.account.link',
      actorUserId: 'staff-1',
      entityId: 'resident-1',
    }));
  });

  it('does not link a record if there is no matching student account', async () => {
    prisma.resident.findFirst.mockResolvedValue({
      id: 'resident-1',
      email: 'student@example.test',
      userId: null,
    });
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.linkAccountByEmail('tenant-1', 'branch-1', 'staff-1', 'resident-1'),
    ).rejects.toThrow('No active student account with the same email was found');
    expect(prisma.resident.updateMany).not.toHaveBeenCalled();
  });

  it('updates only basic fields on the signed-in student resident record', async () => {
    const updatedAt = new Date();
    prisma.resident.findFirst.mockResolvedValue({
      id: 'resident-1',
      tenantId: 'tenant-1',
      branchId: 'branch-1',
      userId: 'student-1',
      firstName: 'Amina',
      lastName: 'Khan',
      phone: null,
      email: 'student@example.test',
      dateOfBirth: null,
      status: 'ACTIVE',
      createdAt: updatedAt,
      updatedAt,
      deletedAt: null,
      cnicEncrypted: null,
    });
    prisma.resident.update.mockImplementation(({ data }: any) => ({
      id: 'resident-1',
      tenantId: 'tenant-1',
      branchId: 'branch-1',
      userId: 'student-1',
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      email: 'student@example.test',
      dateOfBirth: data.dateOfBirth,
      status: 'ACTIVE',
      createdAt: updatedAt,
      updatedAt,
      deletedAt: null,
      cnicEncrypted: null,
    }));

    const dto = Object.assign(new UpdateMyResidentProfileDto(), {
      firstName: '  Amina ',
      lastName: ' Khan  ',
      phone: ' 03001234567 ',
      dateOfBirth: '2000-01-02',
    });
    const result = await service.updateMyProfile('tenant-1', 'branch-1', 'student-1', dto);

    expect(prisma.resident.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', branchId: 'branch-1', userId: 'student-1', deletedAt: null },
    });
    expect(prisma.resident.update).toHaveBeenCalledWith({
      where: { id: 'resident-1' },
      data: {
        firstName: 'Amina',
        lastName: 'Khan',
        phone: '03001234567',
        dateOfBirth: new Date('2000-01-02'),
      },
    });
    expect(result).toMatchObject({
      firstName: 'Amina',
      lastName: 'Khan',
      phone: '03001234567',
      email: 'student@example.test',
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'student-1',
      action: 'resident.self_update',
      entityId: 'resident-1',
    }));
  });

  it('does not update a profile when the student has no linked resident record', async () => {
    prisma.resident.findFirst.mockResolvedValue(null);

    await expect(
      service.updateMyProfile('tenant-1', 'branch-1', 'student-1', {
        firstName: 'Amina',
        lastName: 'Khan',
      }),
    ).rejects.toThrow('Student account is not linked to a resident record');
    expect(prisma.resident.update).not.toHaveBeenCalled();
  });
});
