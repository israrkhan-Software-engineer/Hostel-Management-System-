import { NotFoundException } from '@nestjs/common';
import { Phase6Service } from './phase6.service';

describe('Phase6Service', () => {
  let service: Phase6Service;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      branch: {
        findFirst: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{
        activeResidents: 3,
        occupiedBeds: 4,
        availableBeds: 8,
        pendingAdmissions: 5,
        openComplaints: 6,
        pendingVisitorVisits: 7,
      }]),
    };
    service = new Phase6Service(prisma);
  });

  it('returns branch-scoped dashboard counts without resident or financial details', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: 'branch-1' });

    const result = await service.getOfflineDashboard('tenant-1', 'branch-1');

    expect(result).toEqual({
      activeResidents: 3,
      occupiedBeds: 4,
      availableBeds: 8,
      pendingAdmissions: 5,
      openComplaints: 6,
      pendingVisitorVisits: 7,
      capturedAt: expect.any(String),
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('residentDetails');
    expect(result).not.toHaveProperty('financialTotals');
  });

  it('reports a safe read-only cache mode for offline access', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: 'branch-1' });

    await expect(service.getOfflineStatus('tenant-1', 'branch-1')).resolves.toEqual(
      expect.objectContaining({
        mode: 'READ_ONLY_CACHE',
        readOnly: true,
        cacheEnabled: true,
        syncRequired: true,
        queueableActions: ['student-complaint-submission'],
      }),
    );

    expect(prisma.branch.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'branch-1',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
  });

  it('verifies backup readiness and notes policy deferral without automatic cleanup', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: 'branch-1' });
    const originalBackupDir = process.env.BACKUP_DIR;
    const originalRetention = process.env.BACKUP_RETENTION_DAYS;
    process.env.BACKUP_DIR = '/tmp/hms-backups';
    delete process.env.BACKUP_RETENTION_DAYS;

    try {
      const result = await service.getBackupVerification('tenant-1', 'branch-1');

      expect(result).toEqual(expect.objectContaining({
        branchId: 'branch-1',
        scriptPresent: true,
        backupDirectoryConfigured: true,
        configurationReady: true,
        restoreTestPerformed: false,
      }));
      expect(result.warnings).toContain('Retention cleanup remains deferred until the owner approves a policy.');
      expect(result.warnings).toContain(
        'This API-runtime preflight does not execute or verify the host Docker Compose backup/restore workflow.',
      );
    } finally {
      if (originalBackupDir === undefined) delete process.env.BACKUP_DIR;
      else process.env.BACKUP_DIR = originalBackupDir;

      if (originalRetention === undefined) delete process.env.BACKUP_RETENTION_DAYS;
      else process.env.BACKUP_RETENTION_DAYS = originalRetention;
    }
  });

  it('rejects unknown branches before exposing the offline or backup status', async () => {
    prisma.branch.findFirst.mockResolvedValue(null);

    await expect(service.getOfflineStatus('tenant-1', 'branch-404')).rejects.toThrow(NotFoundException);
    await expect(service.getBackupVerification('tenant-1', 'branch-404')).rejects.toThrow(NotFoundException);
  });
});
