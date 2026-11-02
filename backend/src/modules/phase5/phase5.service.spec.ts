import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { decryptField, fingerprintField } from '../../common/utils/field-encryption.util';
import { CreateVisitorVisitDto } from './phase5.dto';
import { Phase5Service } from './phase5.service';

describe('Phase5Service', () => {
  let service: Phase5Service;
  let prisma: any;
  let audit: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
      resident: { findFirst: jest.fn().mockResolvedValue({ id: 'resident-1' }) },
      visitorVisit: {
        findMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        findFirstOrThrow: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new Phase5Service(
      prisma,
      audit as any,
      { getOrThrow: jest.fn().mockReturnValue('unit-test-field-key') } as any,
    );
  });

  it('lists only branch visits and supports case-insensitive history search', async () => {
    prisma.visitorVisit.findMany.mockResolvedValue([]);

    await service.listVisitorVisits('tenant-1', 'branch-1', '  Sam  ');

    expect(prisma.visitorVisit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: 'tenant-1',
        branchId: 'branch-1',
        deletedAt: null,
        OR: [
          { visitorName: { contains: 'Sam', mode: 'insensitive' } },
          { visitorPhone: { contains: 'Sam', mode: 'insensitive' } },
        ],
      },
      take: 200,
    }));
  });

  it('searches by tenant-scoped CNIC fingerprint without querying plaintext', async () => {
    prisma.visitorVisit.findMany.mockResolvedValue([]);

    await service.listVisitorVisits('tenant-1', 'branch-1', '12345-1234567-1');

    const query = prisma.visitorVisit.findMany.mock.calls[0][0].where.OR;
    expect(query).toContainEqual({
      cnicFingerprint: fingerprintField('tenant-1:1234512345671', 'unit-test-field-key'),
    });
    expect(JSON.stringify(query)).not.toContain('1234512345671');
  });

  it('requires a valid visitor name and Pakistani CNIC format', async () => {
    const valid = Object.assign(new CreateVisitorVisitDto(), {
      visitorName: "Élodie O'Neil",
      cnic: '12345-1234567-1',
      hostResidentId: '550e8400-e29b-41d4-a716-446655440000',
      purpose: 'Family visit',
    });
    const invalid = Object.assign(new CreateVisitorVisitDto(), {
      visitorName: '12345',
      cnic: '123456789012',
      hostResidentId: '550e8400-e29b-41d4-a716-446655440000',
      purpose: 'Family visit',
    });

    expect(await validate(valid)).toHaveLength(0);
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('rejects inactive or cross-branch resident hosts without creating a visit', async () => {
    prisma.resident.findFirst.mockResolvedValue(null);

    await expect(service.createVisitorVisit('tenant-1', 'branch-1', 'staff-1', {
      visitorName: 'Sam Visitor',
      cnic: '12345-1234567-1',
      hostResidentId: 'resident-2',
      purpose: 'Family visit',
    })).rejects.toThrow(BadRequestException);

    expect(prisma.resident.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'resident-2',
        tenantId: 'tenant-1',
        branchId: 'branch-1',
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(prisma.visitorVisit.create).not.toHaveBeenCalled();
  });

  it('creates pending visits with trimmed details and excludes visitor PII from audit data', async () => {
    const visit = { id: 'visit-1', status: 'PENDING', cnicMasked: null };
    prisma.visitorVisit.create.mockResolvedValue(visit);

    await expect(service.createVisitorVisit('tenant-1', 'branch-1', 'staff-1', {
      visitorName: ' Sam Visitor ',
      cnic: '12345-1234567-1',
      visitorPhone: ' 555-0100 ',
      hostResidentId: 'resident-1',
      purpose: ' Family visit ',
    })).resolves.toEqual(visit);

    expect(prisma.visitorVisit.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        tenantId: 'tenant-1',
        branchId: 'branch-1',
        hostResidentId: 'resident-1',
        visitorName: 'Sam Visitor',
        visitorPhone: '555-0100',
        cnicEncrypted: expect.any(String),
        cnicFingerprint: fingerprintField('tenant-1:1234512345671', 'unit-test-field-key'),
        purpose: 'Family visit',
        createdByUserId: 'staff-1',
      },
    }));
    const savedCnic = prisma.visitorVisit.create.mock.calls[0][0].data.cnicEncrypted;
    expect(decryptField(savedCnic, 'unit-test-field-key')).toBe('1234512345671');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      afterData: { status: 'PENDING' },
    }));
    expect(JSON.stringify(audit.log.mock.calls[0][0])).not.toContain('1234512345671');
  });

  it('requires approval before check-in and check-in before check-out', async () => {
    prisma.visitorVisit.findFirst.mockResolvedValue({ id: 'visit-1', status: 'PENDING' });

    await expect(service.checkInVisitor('tenant-1', 'branch-1', 'security-1', 'visit-1'))
      .rejects.toThrow(ConflictException);
    expect(prisma.visitorVisit.updateMany).not.toHaveBeenCalled();

    prisma.visitorVisit.findFirst.mockResolvedValue(null);
    await expect(service.approveVisitorVisit('tenant-1', 'branch-1', 'warden-1', 'visit-2'))
      .rejects.toThrow(NotFoundException);
  });

  it('records approval, check-in, and check-out as guarded status transitions', async () => {
    const visit = { id: 'visit-1', status: 'APPROVED', cnicMasked: null };
    prisma.visitorVisit.findFirst.mockResolvedValue({ id: 'visit-1', status: 'PENDING' });
    prisma.visitorVisit.updateMany.mockResolvedValue({ count: 1 });
    prisma.visitorVisit.findFirstOrThrow.mockResolvedValue(visit);

    await expect(service.approveVisitorVisit('tenant-1', 'branch-1', 'warden-1', 'visit-1'))
      .resolves.toEqual(visit);
    expect(prisma.visitorVisit.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'visit-1', tenantId: 'tenant-1', branchId: 'branch-1', status: 'PENDING', deletedAt: null },
      data: expect.objectContaining({
        status: 'APPROVED',
        approvedByUserId: 'warden-1',
        approvedAt: expect.any(Date),
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'visitor.approve',
      beforeData: { status: 'PENDING' },
      afterData: { status: 'APPROVED' },
    }));

    prisma.visitorVisit.findFirst.mockResolvedValue({ id: 'visit-1', status: 'APPROVED' });
    prisma.visitorVisit.findFirstOrThrow.mockResolvedValue({ ...visit, status: 'CHECKED_IN' });
    await service.checkInVisitor('tenant-1', 'branch-1', 'security-1', 'visit-1');
    expect(prisma.visitorVisit.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CHECKED_IN',
        checkedInByUserId: 'security-1',
        checkedInAt: expect.any(Date),
      }),
    }));

    prisma.visitorVisit.findFirst.mockResolvedValue({ id: 'visit-1', status: 'CHECKED_IN' });
    prisma.visitorVisit.findFirstOrThrow.mockResolvedValue({ ...visit, status: 'CHECKED_OUT' });
    await service.checkOutVisitor('tenant-1', 'branch-1', 'security-1', 'visit-1');
    expect(prisma.visitorVisit.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CHECKED_OUT',
        checkedOutByUserId: 'security-1',
        checkedOutAt: expect.any(Date),
      }),
    }));
  });

  it('archives completed visits and preserves their records', async () => {
    prisma.visitorVisit.findFirst.mockResolvedValue({ id: 'visit-1', status: 'CHECKED_OUT' });
    prisma.visitorVisit.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.archiveVisitorVisit('tenant-1', 'branch-1', 'staff-1', 'visit-1'))
      .resolves.toEqual({ id: 'visit-1', archivedAt: expect.any(Date) });

    expect(prisma.visitorVisit.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'visit-1',
        tenantId: 'tenant-1',
        branchId: 'branch-1',
        deletedAt: null,
        status: 'CHECKED_OUT',
      },
      data: { deletedAt: expect.any(Date) },
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'visitor.archive',
    }));
  });

  it('rejects simultaneous state changes when the guarded update no longer matches', async () => {
    prisma.visitorVisit.findFirst.mockResolvedValue({ id: 'visit-1', status: 'PENDING' });
    prisma.visitorVisit.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.approveVisitorVisit('tenant-1', 'branch-1', 'warden-1', 'visit-1'))
      .rejects.toThrow(ConflictException);
    expect(prisma.visitorVisit.findFirstOrThrow).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects excessive search terms and does not expose visits from unrelated branches', async () => {
    await expect(service.listVisitorVisits('tenant-1', 'branch-1', 'x'.repeat(101)))
      .rejects.toThrow(BadRequestException);
    expect(prisma.visitorVisit.findMany).not.toHaveBeenCalled();

    prisma.branch.findFirst.mockResolvedValue(null);
    await expect(service.listVisitorVisits('tenant-1', 'branch-2')).rejects.toThrow(NotFoundException);
    expect(prisma.visitorVisit.findMany).not.toHaveBeenCalled();
  });
});
