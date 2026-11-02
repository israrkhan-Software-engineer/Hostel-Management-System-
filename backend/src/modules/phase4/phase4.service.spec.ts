import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Phase4Service } from './phase4.service';

describe('Phase4Service', () => {
  let service: Phase4Service;
  let prisma: any;
  let audit: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      branch: {
        findFirst: jest.fn().mockResolvedValue({ tenant: { timezone: 'Asia/Karachi' } }),
      },
      messMenu: { upsert: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
      messMenuEntry: { deleteMany: jest.fn(), createMany: jest.fn() },
      complaint: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      notice: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new Phase4Service(prisma, audit as any);
  });

  it('saves a weekly menu only for a Monday and replaces its meal entries transactionally', async () => {
    const menu = { id: 'menu-1', entries: [{ dayOfWeek: 1, meal: 'BREAKFAST', description: 'Oats' }] };
    const tx = {
      messMenu: {
        upsert: jest.fn().mockResolvedValue({ id: 'menu-1' }),
        findFirstOrThrow: jest.fn().mockResolvedValue(menu),
      },
      messMenuEntry: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

    await expect(service.saveMessMenu('tenant-1', 'branch-1', 'staff-1', {
      weekStart: '2026-10-21',
      entries: [{ dayOfWeek: 1, meal: 'BREAKFAST' as any, description: 'Oats' }],
    })).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await expect(service.saveMessMenu('tenant-1', 'branch-1', 'staff-1', {
      weekStart: '2026-10-19',
      entries: [
        { dayOfWeek: 1, meal: 'BREAKFAST' as any, description: ' Oats ' },
        { dayOfWeek: 1, meal: 'BREAKFAST' as any, description: 'Toast' },
      ],
    })).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await expect(service.saveMessMenu('tenant-1', 'branch-1', 'staff-1', {
      weekStart: '2026-10-19',
      entries: [{ dayOfWeek: 1, meal: 'BREAKFAST' as any, description: ' Oats ' }],
    })).resolves.toEqual(menu);
    expect(tx.messMenuEntry.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', branchId: 'branch-1', menuId: 'menu-1' },
    });
    expect(tx.messMenuEntry.createMany).toHaveBeenCalledWith({
      data: [{
        tenantId: 'tenant-1',
        branchId: 'branch-1',
        menuId: 'menu-1',
        dayOfWeek: 1,
        meal: 'BREAKFAST',
        description: 'Oats',
      }],
    });
  });

  it('returns an explicit empty menu for a week with no saved entries', async () => {
    prisma.messMenu.findFirst.mockResolvedValue(null);

    await expect(service.listMessMenus('tenant-1', 'branch-1', '2026-10-19')).resolves.toEqual({
      id: null,
      weekStart: new Date('2026-10-19T00:00:00.000Z'),
      entries: [],
    });
  });

  it('limits complaint tracking to the submitter and branch for resident access', async () => {
    prisma.complaint.findMany.mockResolvedValue([]);

    await service.listMyComplaints('tenant-1', 'branch-1', 'resident-1');

    expect(prisma.complaint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: 'tenant-1',
        branchId: 'branch-1',
        submittedByUserId: 'resident-1',
      },
    }));
  });

  it('claims unassigned complaints and prevents stealing another staff member assignment', async () => {
    const openComplaint = {
      id: 'complaint-1',
      status: 'OPEN',
      assignedToUserId: null,
    };
    prisma.complaint.findFirst.mockResolvedValue(openComplaint);
    prisma.complaint.update.mockResolvedValue({
      ...openComplaint,
      status: 'IN_PROGRESS',
      assignedToUserId: 'staff-1',
    });

    await service.assignComplaintToSelf('tenant-1', 'branch-1', 'staff-1', 'complaint-1');
    expect(prisma.complaint.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { assignedToUserId: 'staff-1', status: 'IN_PROGRESS' },
    }));

    prisma.complaint.findFirst.mockResolvedValue({
      ...openComplaint,
      assignedToUserId: 'staff-2',
    });
    await expect(service.assignComplaintToSelf(
      'tenant-1',
      'branch-1',
      'staff-1',
      'complaint-1',
    )).rejects.toThrow(ConflictException);
  });

  it('requires resolution before a complaint can be closed', async () => {
    prisma.complaint.findFirst.mockResolvedValue({ id: 'complaint-1', status: 'OPEN' });

    await expect(service.updateComplaint('tenant-1', 'branch-1', 'staff-1', 'complaint-1', {
      status: 'CLOSED' as any,
    })).rejects.toThrow(ConflictException);
    expect(prisma.complaint.update).not.toHaveBeenCalled();
  });

  it('returns only currently published notices for the tenant-local date', async () => {
    prisma.notice.findMany.mockResolvedValue([]);

    await service.listPublishedNotices('tenant-1', 'branch-1');

    expect(prisma.notice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        branchId: 'branch-1',
        status: 'PUBLISHED',
        AND: expect.arrayContaining([
          { OR: [{ startsAt: null }, { startsAt: { lte: expect.any(Date) } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: expect.any(Date) } }] },
        ]),
      }),
    }));
  });

  it('rejects invalid notice date windows before persisting', async () => {
    await expect(service.createNotice('tenant-1', 'branch-1', 'staff-1', {
      title: 'Closed for maintenance',
      body: 'The dining hall is unavailable.',
      startsAt: '2026-10-23',
      endsAt: '2026-10-22',
    })).rejects.toThrow(BadRequestException);
    expect(prisma.notice.create).not.toHaveBeenCalled();
  });

  it('does not return notices or complaints from an inactive or unrelated branch', async () => {
    prisma.branch.findFirst.mockResolvedValue(null);

    await expect(service.listManagedNotices('tenant-1', 'branch-2')).rejects.toThrow(NotFoundException);
    expect(prisma.notice.findMany).not.toHaveBeenCalled();
  });
});
