import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  DEFAULT_BACKUP_SCHEDULE_POLICY,
  DEFAULT_PHYSICAL_DELETE_POLICY,
  DEFAULT_RETENTION_POLICY,
  DEFAULT_TENANT_BUSINESS_POLICIES,
  DEFAULT_VISITOR_HOURS_POLICY,
  PolicyApprovalStatus,
  PolicyDomain,
  TenantBusinessPolicies,
  VisitorHoursPolicySettings,
} from './business-policies.types';
import {
  PolicyApprovalActionDto,
  UpdateBackupSchedulePolicyDto,
  UpdateDataRetentionPolicyDto,
  UpdatePhysicalDeletePolicyDto,
  UpdateVisitorHoursPolicyDto,
} from './business-policies.dto';

@Injectable()
export class BusinessPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Retrieves the aggregate business policies for a tenant, merged with safe non-destructive defaults.
   */
  async getTenantPolicies(tenantId: string): Promise<TenantBusinessPolicies> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, settings: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const rawSettings = (tenant.settings ?? {}) as Record<string, unknown>;
    const storedPolicies = (rawSettings.businessPolicies ?? {}) as Partial<TenantBusinessPolicies>;

    return this.mergeWithDefaults(storedPolicies);
  }

  /**
   * Retrieves branch-effective policies (tenant policy with branch overrides).
   */
  async getBranchPolicies(tenantId: string, branchId: string) {
    const [tenantPolicies, branch] = await Promise.all([
      this.getTenantPolicies(tenantId),
      this.prisma.branch.findFirst({
        where: { id: branchId, tenantId, deletedAt: null },
        select: { id: true, name: true, operatingSettings: true },
      }),
    ]);
    if (!branch) throw new NotFoundException('Branch not found');

    const branchSettings = (branch.operatingSettings ?? {}) as Record<string, unknown>;
    const branchVisitorOverrides = (branchSettings.visitorPolicy ?? {}) as Partial<VisitorHoursPolicySettings>;

    const effectiveVisitorHours: VisitorHoursPolicySettings = {
      ...tenantPolicies.visitorHours,
      ...branchVisitorOverrides,
    };

    return {
      branchId: branch.id,
      branchName: branch.name,
      tenantId,
      policies: {
        ...tenantPolicies,
        visitorHours: effectiveVisitorHours,
      },
    };
  }

  /**
   * Updates Data Retention Policy (draft stage, status: PENDING_OWNER_APPROVAL or SUBMITTED).
   */
  async updateRetentionPolicy(
    tenantId: string,
    actorUserId: string,
    dto: UpdateDataRetentionPolicyDto,
  ) {
    const current = await this.getTenantPolicies(tenantId);

    const updatedRetention = {
      ...current.dataRetention,
      residents: { ...current.dataRetention.residents, ...(dto.residents ?? {}) },
      admissions: { ...current.dataRetention.admissions, ...(dto.admissions ?? {}) },
      financialRecords: {
        ...current.dataRetention.financialRecords,
        ...(dto.financialRecords ?? {}),
        immutableFinancialLock: true as const, // Strict non-negotiable invariant
      },
      documents: { ...current.dataRetention.documents, ...(dto.documents ?? {}) },
      visitors: { ...current.dataRetention.visitors, ...(dto.visitors ?? {}) },
      auditLogs: {
        ...current.dataRetention.auditLogs,
        ...(dto.auditLogs ?? {}),
        immutableAuditLock: true as const, // Strict non-negotiable invariant
      },
      autoPurgeEnabled: dto.autoPurgeEnabled ?? current.dataRetention.autoPurgeEnabled,
      approvalStatus: 'PENDING_OWNER_APPROVAL' as PolicyApprovalStatus, // Reverts to pending when modified
      approvedByUserId: null,
      approvedAt: null,
      notes: dto.notes ?? current.dataRetention.notes,
    };

    const newPolicies: TenantBusinessPolicies = {
      ...current,
      dataRetention: updatedRetention,
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedByUserId: actorUserId,
    };

    await this.saveTenantPolicies(tenantId, newPolicies);

    await this.audit.log({
      tenantId,
      actorUserId,
      action: 'policy.retention_update',
      module: 'tenants',
      entityType: 'policy',
      entityId: 'dataRetention',
      beforeData: { autoPurgeEnabled: current.dataRetention.autoPurgeEnabled },
      afterData: { autoPurgeEnabled: updatedRetention.autoPurgeEnabled },
      outcome: 'success',
    });

    return updatedRetention;
  }

  /**
   * Updates Backup Schedule Policy (draft stage, separated from retention).
   */
  async updateBackupSchedulePolicy(
    tenantId: string,
    actorUserId: string,
    dto: UpdateBackupSchedulePolicyDto,
  ) {
    const current = await this.getTenantPolicies(tenantId);

    const updatedSchedule = {
      ...current.backupSchedule,
      ...dto,
      approvalStatus: 'PENDING_OWNER_APPROVAL' as PolicyApprovalStatus,
      approvedByUserId: null,
      approvedAt: null,
    };

    const newPolicies: TenantBusinessPolicies = {
      ...current,
      backupSchedule: updatedSchedule,
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedByUserId: actorUserId,
    };

    await this.saveTenantPolicies(tenantId, newPolicies);

    await this.audit.log({
      tenantId,
      actorUserId,
      action: 'policy.backup_schedule_update',
      module: 'tenants',
      entityType: 'policy',
      entityId: 'backupSchedule',
      beforeData: { frequency: current.backupSchedule.frequency },
      afterData: { frequency: updatedSchedule.frequency },
      outcome: 'success',
    });

    return updatedSchedule;
  }

  /**
   * Updates Visitor Hours Policy (either at tenant level or branch level).
   */
  async updateVisitorHoursPolicy(
    tenantId: string,
    branchId: string | null,
    actorUserId: string,
    dto: UpdateVisitorHoursPolicyDto,
  ) {
    if (branchId) {
      // Branch-level override
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, tenantId, deletedAt: null },
        select: { id: true, operatingSettings: true },
      });
      if (!branch) throw new NotFoundException('Branch not found');

      const branchSettings = (branch.operatingSettings ?? {}) as Record<string, unknown>;
      const currentOverrides = (branchSettings.visitorPolicy ?? {}) as Partial<VisitorHoursPolicySettings>;

      const updatedOverrides: Partial<VisitorHoursPolicySettings> = {
        ...currentOverrides,
        ...dto,
        approvalStatus: 'PENDING_OWNER_APPROVAL',
      };

      await this.prisma.branch.update({
        where: { id: branch.id },
        data: {
          operatingSettings: {
            ...branchSettings,
            visitorPolicy: updatedOverrides,
          } as Prisma.InputJsonValue,
        },
      });

      await this.audit.log({
        tenantId,
        branchId,
        actorUserId,
        action: 'policy.branch_visitor_hours_update',
        module: 'visitors',
        entityType: 'policy',
        entityId: branchId,
        afterData: updatedOverrides,
        outcome: 'success',
      });

      return updatedOverrides;
    }

    // Tenant-level default
    const current = await this.getTenantPolicies(tenantId);
    const updatedVisitor = {
      ...current.visitorHours,
      ...dto,
      approvalStatus: 'PENDING_OWNER_APPROVAL' as PolicyApprovalStatus,
      approvedByUserId: null,
      approvedAt: null,
    };

    const newPolicies: TenantBusinessPolicies = {
      ...current,
      visitorHours: updatedVisitor,
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedByUserId: actorUserId,
    };

    await this.saveTenantPolicies(tenantId, newPolicies);

    await this.audit.log({
      tenantId,
      actorUserId,
      action: 'policy.visitor_hours_update',
      module: 'visitors',
      entityType: 'policy',
      entityId: 'visitorHours',
      afterData: updatedVisitor,
      outcome: 'success',
    });

    return updatedVisitor;
  }

  /**
   * Updates Physical Delete Policy.
   */
  async updatePhysicalDeletePolicy(
    tenantId: string,
    actorUserId: string,
    dto: UpdatePhysicalDeletePolicyDto,
  ) {
    const current = await this.getTenantPolicies(tenantId);

    const updatedDelete = {
      ...current.physicalDelete,
      ...dto,
      financialRecordsPermanentLock: true as const, // Strict non-negotiable invariant
      auditLogsPermanentLock: true as const, // Strict non-negotiable invariant
      approvalStatus: 'PENDING_OWNER_APPROVAL' as PolicyApprovalStatus,
      approvedByUserId: null,
      approvedAt: null,
    };

    const newPolicies: TenantBusinessPolicies = {
      ...current,
      physicalDelete: updatedDelete,
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedByUserId: actorUserId,
    };

    await this.saveTenantPolicies(tenantId, newPolicies);

    await this.audit.log({
      tenantId,
      actorUserId,
      action: 'policy.physical_delete_update',
      module: 'tenants',
      entityType: 'policy',
      entityId: 'physicalDelete',
      afterData: { allowPhysicalDeletion: updatedDelete.allowPhysicalDeletion },
      outcome: 'success',
    });

    return updatedDelete;
  }

  /**
   * Approval Workflow: Submit, Approve, or Reject a policy domain.
   * APPROVE action strictly requires Owner role or Platform Super Admin.
   */
  async handleApprovalAction(
    tenantId: string,
    domain: PolicyDomain,
    actorUserId: string,
    dto: PolicyApprovalActionDto,
    isOwnerOrPlatformAdmin: boolean,
  ) {
    const current = await this.getTenantPolicies(tenantId);
    const targetPolicy = current[domain];
    if (!targetPolicy) throw new BadRequestException(`Invalid policy domain: ${domain}`);

    if (dto.action === 'APPROVE' && !isOwnerOrPlatformAdmin) {
      throw new ForbiddenException(
        'Business policies require explicit Owner or Super Admin approval.',
      );
    }

    let nextStatus: PolicyApprovalStatus;
    let approvedBy: string | null = null;
    let approvedAt: string | null = null;
    let rejectionReason: string | null = null;

    if (dto.action === 'SUBMIT') {
      nextStatus = 'SUBMITTED';
    } else if (dto.action === 'APPROVE') {
      nextStatus = 'APPROVED';
      approvedBy = actorUserId;
      approvedAt = new Date().toISOString();
    } else {
      nextStatus = 'REJECTED';
      rejectionReason = dto.rejectionReason ?? 'Rejected by owner';
    }

    const updatedDomainPolicy = {
      ...targetPolicy,
      approvalStatus: nextStatus,
      approvedByUserId: approvedBy,
      approvedAt: approvedAt,
      rejectionReason: rejectionReason,
    };

    const newPolicies: TenantBusinessPolicies = {
      ...current,
      [domain]: updatedDomainPolicy,
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedByUserId: actorUserId,
    };

    await this.saveTenantPolicies(tenantId, newPolicies);

    await this.audit.log({
      tenantId,
      actorUserId,
      action: `policy.${domain}_${dto.action.toLowerCase()}`,
      module: 'tenants',
      entityType: 'policy',
      entityId: domain,
      beforeData: { status: targetPolicy.approvalStatus },
      afterData: { status: nextStatus },
      outcome: 'success',
    });

    return updatedDomainPolicy;
  }

  /**
   * Policy Evaluation: checks whether an entity type is authorized for permanent physical deletion.
   * Returns false by default to ensure safe non-destructive behavior.
   */
  async canPhysicallyDelete(
    tenantId: string,
    entityType: 'studentDocument' | 'resident' | 'admission' | 'financial' | 'auditLog',
  ): Promise<boolean> {
    // Financial and audit logs can NEVER be physically deleted under any circumstance
    if (entityType === 'financial' || entityType === 'auditLog') {
      return false;
    }

    const policies = await this.getTenantPolicies(tenantId);
    const deletePolicy = policies.physicalDelete;

    // Must be approved by owner and physical deletion globally permitted
    if (deletePolicy.approvalStatus !== 'APPROVED' || !deletePolicy.allowPhysicalDeletion) {
      return false;
    }

    switch (entityType) {
      case 'studentDocument':
        return deletePolicy.studentDocumentsPhysicalDeleteAllowed === true;
      case 'resident':
        return deletePolicy.residentRecordsPhysicalDeleteAllowed === true;
      case 'admission':
        return deletePolicy.admissionRecordsPhysicalDeleteAllowed === true;
      default:
        return false;
    }
  }

  /**
   * Policy Evaluation: checks whether visitor entry is within allowed visiting hours.
   */
  async evaluateVisitorEntry(
    tenantId: string,
    branchId: string,
    date: Date = new Date(),
  ): Promise<{
    allowed: boolean;
    requiresOverride: boolean;
    reason?: string;
  }> {
    const branchEffective = await this.getBranchPolicies(tenantId, branchId);
    const policy = branchEffective.policies.visitorHours;

    // If visiting hours are not enforced or still pending approval, do not block (advisory only)
    if (!policy.enabled || policy.approvalStatus !== 'APPROVED') {
      return { allowed: true, requiresOverride: false };
    }

    // Convert date to HH:MM format
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const currentTime = `${hours}:${minutes}`;
    const dayOfWeek = date.getDay();

    if (!policy.allowedDaysOfWeek.includes(dayOfWeek)) {
      return {
        allowed: false,
        requiresOverride: true,
        reason: `Visiting is not permitted on this day of the week according to hostel policy.`,
      };
    }

    if (currentTime < policy.entryStartTime || currentTime > policy.entryEndTime) {
      return {
        allowed: false,
        requiresOverride: true,
        reason: `Current time (${currentTime}) is outside approved visitor entry hours (${policy.entryStartTime} - ${policy.entryEndTime}).`,
      };
    }

    return { allowed: true, requiresOverride: false };
  }

  private async saveTenantPolicies(tenantId: string, policies: TenantBusinessPolicies) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const rawSettings = (tenant?.settings ?? {}) as Record<string, unknown>;

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: {
          ...rawSettings,
          businessPolicies: policies,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private mergeWithDefaults(stored: Partial<TenantBusinessPolicies>): TenantBusinessPolicies {
    return {
      version: stored.version ?? DEFAULT_TENANT_BUSINESS_POLICIES.version,
      dataRetention: {
        ...DEFAULT_RETENTION_POLICY,
        ...(stored.dataRetention ?? {}),
        financialRecords: {
          ...DEFAULT_RETENTION_POLICY.financialRecords,
          ...(stored.dataRetention?.financialRecords ?? {}),
          immutableFinancialLock: true,
        },
        auditLogs: {
          ...DEFAULT_RETENTION_POLICY.auditLogs,
          ...(stored.dataRetention?.auditLogs ?? {}),
          immutableAuditLock: true,
        },
      },
      backupSchedule: {
        ...DEFAULT_BACKUP_SCHEDULE_POLICY,
        ...(stored.backupSchedule ?? {}),
      },
      visitorHours: {
        ...DEFAULT_VISITOR_HOURS_POLICY,
        ...(stored.visitorHours ?? {}),
      },
      physicalDelete: {
        ...DEFAULT_PHYSICAL_DELETE_POLICY,
        ...(stored.physicalDelete ?? {}),
        financialRecordsPermanentLock: true,
        auditLogsPermanentLock: true,
      },
      lastUpdatedAt: stored.lastUpdatedAt ?? DEFAULT_TENANT_BUSINESS_POLICIES.lastUpdatedAt,
      lastUpdatedByUserId: stored.lastUpdatedByUserId ?? null,
    };
  }
}
