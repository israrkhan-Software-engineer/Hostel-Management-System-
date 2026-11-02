import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';

export type OfflineStatusResponse = {
  mode: 'READ_ONLY_CACHE';
  readOnly: true;
  cacheEnabled: true;
  syncRequired: true;
  allowedData: string[];
  blockedActions: string[];
  summary: string;
  lastCheckedAt: string;
};

export type OfflineDashboardResponse = {
  activeResidents: number;
  occupiedBeds: number;
  availableBeds: number;
  pendingAdmissions: number;
  openComplaints: number;
  pendingVisitorVisits: number;
  capturedAt: string;
};

export type BackupVerificationResponse = {
  branchId: string;
  scriptPresent: boolean;
  backupDirectoryConfigured: boolean;
  retentionPolicyConfigured: boolean;
  retentionPolicy: string;
  configurationReady: boolean;
  restoreTestPerformed: false;
  warnings: string[];
  reviewedAt: string;
};

@Injectable()
export class Phase6Service {
  constructor(private readonly prisma: PrismaService) {}

  async getOfflineStatus(tenantId: string, branchId: string): Promise<OfflineStatusResponse> {
    await this.ensureBranch(tenantId, branchId);
    return {
      mode: 'READ_ONLY_CACHE',
      readOnly: true,
      cacheEnabled: true,
      syncRequired: true,
      allowedData: ['dashboard-counts'],
      blockedActions: [
        'create',
        'update',
        'delete',
        'approve',
        'check-in',
        'check-out',
        'payment',
        'refund',
      ],
      summary:
        'Aggregate branch dashboard counts are cached in the current browser session. Offline writes are blocked and never queued; refresh the snapshot only while online.',
      lastCheckedAt: new Date().toISOString(),
    };
  }

  async getOfflineDashboard(tenantId: string, branchId: string): Promise<OfflineDashboardResponse> {
    await this.ensureBranch(tenantId, branchId);
    const [counts] = await this.prisma.$queryRaw<{
      activeResidents: number;
      occupiedBeds: number;
      availableBeds: number;
      pendingAdmissions: number;
      openComplaints: number;
      pendingVisitorVisits: number;
    }[]>(Prisma.sql`
      SELECT
        (SELECT COUNT(*)::int FROM residents
          WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${branchId}::uuid
            AND status = 'ACTIVE' AND deleted_at IS NULL) AS "activeResidents",
        (SELECT COUNT(*)::int FROM beds
          WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${branchId}::uuid
            AND status = 'OCCUPIED' AND deleted_at IS NULL) AS "occupiedBeds",
        (SELECT COUNT(*)::int FROM beds
          WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${branchId}::uuid
            AND status = 'AVAILABLE' AND deleted_at IS NULL) AS "availableBeds",
        (SELECT COUNT(*)::int FROM admissions
          WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${branchId}::uuid
            AND status = 'PENDING' AND deleted_at IS NULL) AS "pendingAdmissions",
        (SELECT COUNT(*)::int FROM complaints
          WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${branchId}::uuid
            AND status IN ('OPEN', 'IN_PROGRESS')) AS "openComplaints",
        (SELECT COUNT(*)::int FROM visitor_visits
          WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${branchId}::uuid
            AND status = 'PENDING') AS "pendingVisitorVisits"
    `);

    return {
      ...counts,
      capturedAt: new Date().toISOString(),
    };
  }

  async refreshOfflineStatus(tenantId: string, branchId: string): Promise<OfflineStatusResponse> {
    return this.getOfflineStatus(tenantId, branchId);
  }

  async getBackupVerification(tenantId: string, branchId: string): Promise<BackupVerificationResponse> {
    await this.ensureBranch(tenantId, branchId);
    const backupDir = process.env.BACKUP_DIR || '';
    const retentionValue = process.env.BACKUP_RETENTION_DAYS ?? 'PENDING_OWNER_DECISION';
    const scriptPath = path.resolve(process.cwd(), '..', 'infrastructure', 'scripts', 'backup.sh');
    const scriptPresent = fs.existsSync(scriptPath);
    const backupDirectoryConfigured = Boolean(backupDir);
    const retentionPolicyConfigured = Boolean(retentionValue) && retentionValue !== 'PENDING_OWNER_DECISION' && /^[0-9]+$/.test(retentionValue);
    const warnings: string[] = [];

    if (!scriptPresent) {
      warnings.push(
        'The backup script is not available at the expected path in this API runtime; the repository host copy is not assessed.',
      );
    }
    if (!backupDirectoryConfigured) {
      warnings.push(
        'BACKUP_DIR is not configured in this API runtime; host-side backup environment is not assessed.',
      );
    }
    if (!retentionPolicyConfigured) warnings.push('Retention cleanup remains deferred until the owner approves a policy.');
    warnings.push(
      'This API-runtime preflight does not execute or verify the host Docker Compose backup/restore workflow.',
    );

    return {
      branchId,
      scriptPresent,
      backupDirectoryConfigured,
      retentionPolicyConfigured,
      retentionPolicy: retentionValue,
      configurationReady: scriptPresent && backupDirectoryConfigured,
      restoreTestPerformed: false,
      warnings,
      reviewedAt: new Date().toISOString(),
    };
  }

  async runBackupVerification(tenantId: string, branchId: string): Promise<BackupVerificationResponse> {
    return this.getBackupVerification(tenantId, branchId);
  }

  private async ensureBranch(tenantId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        tenantId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
  }
}
