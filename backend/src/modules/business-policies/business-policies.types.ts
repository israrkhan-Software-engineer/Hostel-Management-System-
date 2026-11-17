// ==============================================================================
// HMS Business Policies Domain Types & Safe Defaults
// ==============================================================================
// These types define the configurable business policy foundations:
// 1. Data Retention Policy (Record & file lifecycle rules)
// 2. Backup Schedule Policy (Separated from retention duration)
// 3. Visitor Hours Policy (Hostel entry/exit rules & administrative overrides)
// 4. Physical Delete Policy (Guarding against unauthorized permanent deletion)
//
// POLICY INVARIANT:
// All policies default to safe, non-destructive settings with status
// 'PENDING_OWNER_APPROVAL'. No business decisions are invented or finalized
// without owner sign-off.
// ==============================================================================

export type PolicyApprovalStatus =
  | 'PENDING_OWNER_APPROVAL'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED';

export type PolicyDomain =
  | 'dataRetention'
  | 'backupSchedule'
  | 'visitorHours'
  | 'physicalDelete';

// ── 1. Data Retention Policy Types ───────────────────────────────────────────
export interface ResidentRetentionRule {
  /** Days after resident status becomes DEPARTED before retention action triggers (null = indefinite) */
  retentionDaysAfterDeparture: number | null;
  retentionScope: 'DEPARTED_ONLY' | 'ALL_STATUSES';
  actionOnExpiry: 'RETAIN_INDEFINITELY' | 'ARCHIVE_SOFT_DELETE' | 'ANONYMIZE_PII';
}

export interface AdmissionRetentionRule {
  /** Days after an admission is rejected before retention action triggers (null = indefinite) */
  rejectedRetentionDays: number | null;
  /** Days after an admission is cancelled before retention action triggers (null = indefinite) */
  cancelledRetentionDays: number | null;
  actionOnExpiry: 'RETAIN_INDEFINITELY' | 'ARCHIVE_SOFT_DELETE';
}

export interface FinancialRetentionRule {
  /** Statutory retention duration in days (minimum 2555 days / 7 years for fiscal compliance) */
  statutoryRetentionDays: number | null;
  /** Invariant: Invoices, payments, and refunds cannot be deleted or purged */
  immutableFinancialLock: true;
  actionOnExpiry: 'RETAIN_INDEFINITELY';
}

export interface DocumentRetentionRule {
  /** Days after resident departure to retain student verification documents */
  studentDocumentsRetentionDays: number | null;
  /** Days to retain payment bank proof images/slips (must align with financial retention) */
  paymentProofsRetentionDays: number | null;
  actionOnExpiry: 'RETAIN_INDEFINITELY' | 'ARCHIVE_SOFT_DELETE';
}

export interface VisitorRetentionRule {
  /** Days after visitor checkout before retention action triggers (e.g. 90-365 days) */
  retentionDaysAfterCheckout: number | null;
  actionOnExpiry: 'RETAIN_INDEFINITELY' | 'ARCHIVE_SOFT_DELETE' | 'ANONYMIZE_PII';
}

export interface AuditLogRetentionRule {
  /** Regulatory retention period in days (null = permanent immutable compliance) */
  retentionDays: number | null;
  /** Invariant: Audit logs are strictly append-only and cannot be purged */
  immutableAuditLock: true;
  actionOnExpiry: 'RETAIN_INDEFINITELY';
}

export interface DataRetentionPolicySettings {
  residents: ResidentRetentionRule;
  admissions: AdmissionRetentionRule;
  financialRecords: FinancialRetentionRule;
  documents: DocumentRetentionRule;
  visitors: VisitorRetentionRule;
  auditLogs: AuditLogRetentionRule;
  /** Invariant: Automated background deletion is disabled by default */
  autoPurgeEnabled: boolean;
  approvalStatus: PolicyApprovalStatus;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  notes?: string;
}

// ── 2. Backup Schedule Policy Types ──────────────────────────────────────────
export type BackupFrequency = 'DAILY' | 'TWICE_DAILY' | 'WEEKLY' | 'CUSTOM_CRON';

export interface BackupSchedulePolicySettings {
  /** Backup frequency — separated from retention period */
  frequency: BackupFrequency;
  /** Custom cron expression if frequency is CUSTOM_CRON */
  customCronExpression: string | null;
  /** Primary scheduled execution time (UTC) e.g. "02:00" */
  preferredExecutionTimeUtc: string;
  /** Secondary execution time (UTC) for twice-daily schedules e.g. "14:00" */
  secondaryExecutionTimeUtc: string | null;
  /** Preferred day of week (0=Sunday to 6=Saturday) for weekly backups */
  preferredDayOfWeek: number;
  /** Scope toggles */
  includeDatabaseDump: boolean;
  includeWalContinuousArchiving: boolean;
  includeObjectStorage: boolean;
  offsiteReplicationEnabled: boolean;
  approvalStatus: PolicyApprovalStatus;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  notes?: string;
}

// ── 3. Visitor Hours Policy Types ────────────────────────────────────────────
export interface VisitorHoursPolicySettings {
  /** Whether visitor hours restrictions are actively enforced */
  enabled: boolean;
  /** Earliest allowed visitor check-in time (HH:MM in 24h format, e.g. "09:00") */
  entryStartTime: string;
  /** Latest allowed visitor check-in time (HH:MM in 24h format, e.g. "20:00") */
  entryEndTime: string;
  /** Compulsory visitor departure deadline (HH:MM in 24h format, e.g. "21:00") */
  exitDeadlineTime: string;
  /** Maximum permissible duration for a single visit in minutes (e.g. 120) */
  maxVisitDurationMinutes: number;
  /** Allowed days of week (0=Sunday, 1=Monday, ..., 6=Saturday) */
  allowedDaysOfWeek: number[];
  /** Whether overnight visitor stays are permitted */
  allowOvernightStay: boolean;
  /** Administrative emergency override permitted with explicit reason */
  allowEmergencyOverride: boolean;
  /** Mandatory CNIC verification before check-in */
  requireCnicVerification: boolean;
  approvalStatus: PolicyApprovalStatus;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  notes?: string;
}

// ── 4. Physical Delete Policy Types ──────────────────────────────────────────
export interface PhysicalDeletePolicySettings {
  /** Global master switch: Physical/hard deletion is prohibited by default */
  allowPhysicalDeletion: boolean;
  /** Invariant: Financial records (invoices, payments, refunds) can NEVER be physically deleted */
  financialRecordsPermanentLock: true;
  /** Invariant: Audit logs can NEVER be physically deleted */
  auditLogsPermanentLock: true;
  /** Whether student identity documents may be physically deleted (requires owner approval) */
  studentDocumentsPhysicalDeleteAllowed: boolean;
  /** Whether departed resident records may be physically deleted (requires owner approval) */
  residentRecordsPhysicalDeleteAllowed: boolean;
  /** Whether cancelled admissions may be physically deleted */
  admissionRecordsPhysicalDeleteAllowed: boolean;
  /** Require Owner MFA confirmation for any physical deletion */
  requireOwnerMfaForHardDelete: boolean;
  approvalStatus: PolicyApprovalStatus;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  notes?: string;
}

// ── Aggregate Tenant & Branch Configurations ─────────────────────────────────
export interface TenantBusinessPolicies {
  version: number;
  dataRetention: DataRetentionPolicySettings;
  backupSchedule: BackupSchedulePolicySettings;
  visitorHours: VisitorHoursPolicySettings;
  physicalDelete: PhysicalDeletePolicySettings;
  lastUpdatedAt: string;
  lastUpdatedByUserId?: string | null;
}

export interface BranchBusinessPolicyOverrides {
  visitorHours?: Partial<VisitorHoursPolicySettings>;
  dataRetentionOverrides?: Partial<DataRetentionPolicySettings>;
}

// ── Safe Defaults (Non-Destructive & Pending Approval) ────────────────────────
export const DEFAULT_RETENTION_POLICY: DataRetentionPolicySettings = {
  residents: {
    retentionDaysAfterDeparture: null, // Indefinite pending owner decision
    retentionScope: 'DEPARTED_ONLY',
    actionOnExpiry: 'RETAIN_INDEFINITELY',
  },
  admissions: {
    rejectedRetentionDays: null,
    cancelledRetentionDays: null,
    actionOnExpiry: 'RETAIN_INDEFINITELY',
  },
  financialRecords: {
    statutoryRetentionDays: null, // Fiscal standard is permanent / 7 years
    immutableFinancialLock: true,
    actionOnExpiry: 'RETAIN_INDEFINITELY',
  },
  documents: {
    studentDocumentsRetentionDays: null,
    paymentProofsRetentionDays: null,
    actionOnExpiry: 'RETAIN_INDEFINITELY',
  },
  visitors: {
    retentionDaysAfterCheckout: null,
    actionOnExpiry: 'RETAIN_INDEFINITELY',
  },
  auditLogs: {
    retentionDays: null, // Permanent immutable compliance
    immutableAuditLock: true,
    actionOnExpiry: 'RETAIN_INDEFINITELY',
  },
  autoPurgeEnabled: false, // SAFEGUARD: Never delete automatically
  approvalStatus: 'PENDING_OWNER_APPROVAL',
  notes: 'Pending owner approval (G-09 / OD-06). Automatic purging is disabled; all records are safely retained.',
};

export const DEFAULT_BACKUP_SCHEDULE_POLICY: BackupSchedulePolicySettings = {
  frequency: 'DAILY',
  customCronExpression: null,
  preferredExecutionTimeUtc: '02:00',
  secondaryExecutionTimeUtc: '14:00',
  preferredDayOfWeek: 0,
  includeDatabaseDump: true,
  includeWalContinuousArchiving: true,
  includeObjectStorage: true,
  offsiteReplicationEnabled: false,
  approvalStatus: 'PENDING_OWNER_APPROVAL',
  notes: 'Pending owner approval (G-09 / OD-06). Default daily 02:00 UTC proposed with continuous WAL archiving.',
};

export const DEFAULT_VISITOR_HOURS_POLICY: VisitorHoursPolicySettings = {
  enabled: false, // Non-blocking until owner approves visiting hours
  entryStartTime: '09:00',
  entryEndTime: '20:00',
  exitDeadlineTime: '21:00',
  maxVisitDurationMinutes: 120,
  allowedDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  allowOvernightStay: false,
  allowEmergencyOverride: true,
  requireCnicVerification: true,
  approvalStatus: 'PENDING_OWNER_APPROVAL',
  notes: 'Pending owner approval (G-21). Restrictions remain advisory; emergency overrides are permitted.',
};

export const DEFAULT_PHYSICAL_DELETE_POLICY: PhysicalDeletePolicySettings = {
  allowPhysicalDeletion: false, // SAFEGUARD: Physical deletion disabled
  financialRecordsPermanentLock: true,
  auditLogsPermanentLock: true,
  studentDocumentsPhysicalDeleteAllowed: false,
  residentRecordsPhysicalDeleteAllowed: false,
  admissionRecordsPhysicalDeleteAllowed: false,
  requireOwnerMfaForHardDelete: true,
  approvalStatus: 'PENDING_OWNER_APPROVAL',
  notes: 'Pending owner approval (G-08 / G-21). Permanent deletion is disabled across all entities.',
};

export const DEFAULT_TENANT_BUSINESS_POLICIES: TenantBusinessPolicies = {
  version: 1,
  dataRetention: DEFAULT_RETENTION_POLICY,
  backupSchedule: DEFAULT_BACKUP_SCHEDULE_POLICY,
  visitorHours: DEFAULT_VISITOR_HOURS_POLICY,
  physicalDelete: DEFAULT_PHYSICAL_DELETE_POLICY,
  lastUpdatedAt: new Date(0).toISOString(),
};
