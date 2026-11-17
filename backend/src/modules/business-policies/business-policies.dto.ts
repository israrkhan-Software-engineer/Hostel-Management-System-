import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BackupFrequency } from './business-policies.types';

// ── 1. Data Retention DTOs ───────────────────────────────────────────────────
export class ResidentRetentionRuleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36500) // Up to 100 years
  retentionDaysAfterDeparture?: number | null;

  @IsOptional()
  @IsIn(['DEPARTED_ONLY', 'ALL_STATUSES'])
  retentionScope?: 'DEPARTED_ONLY' | 'ALL_STATUSES';

  @IsOptional()
  @IsIn(['RETAIN_INDEFINITELY', 'ARCHIVE_SOFT_DELETE', 'ANONYMIZE_PII'])
  actionOnExpiry?: 'RETAIN_INDEFINITELY' | 'ARCHIVE_SOFT_DELETE' | 'ANONYMIZE_PII';
}

export class AdmissionRetentionRuleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36500)
  rejectedRetentionDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36500)
  cancelledRetentionDays?: number | null;

  @IsOptional()
  @IsIn(['RETAIN_INDEFINITELY', 'ARCHIVE_SOFT_DELETE'])
  actionOnExpiry?: 'RETAIN_INDEFINITELY' | 'ARCHIVE_SOFT_DELETE';
}

export class FinancialRetentionRuleDto {
  @IsOptional()
  @IsInt()
  @Min(2555) // Minimum 7 years (2555 days) for statutory tax & audit compliance
  statutoryRetentionDays?: number | null;
}

export class DocumentRetentionRuleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36500)
  studentDocumentsRetentionDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36500)
  paymentProofsRetentionDays?: number | null;

  @IsOptional()
  @IsIn(['RETAIN_INDEFINITELY', 'ARCHIVE_SOFT_DELETE'])
  actionOnExpiry?: 'RETAIN_INDEFINITELY' | 'ARCHIVE_SOFT_DELETE';
}

export class VisitorRetentionRuleDto {
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3650)
  retentionDaysAfterCheckout?: number | null;

  @IsOptional()
  @IsIn(['RETAIN_INDEFINITELY', 'ARCHIVE_SOFT_DELETE', 'ANONYMIZE_PII'])
  actionOnExpiry?: 'RETAIN_INDEFINITELY' | 'ARCHIVE_SOFT_DELETE' | 'ANONYMIZE_PII';
}

export class AuditLogRetentionRuleDto {
  @IsOptional()
  @IsInt()
  @Min(365)
  retentionDays?: number | null;
}

export class UpdateDataRetentionPolicyDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ResidentRetentionRuleDto)
  residents?: ResidentRetentionRuleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdmissionRetentionRuleDto)
  admissions?: AdmissionRetentionRuleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FinancialRetentionRuleDto)
  financialRecords?: FinancialRetentionRuleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DocumentRetentionRuleDto)
  documents?: DocumentRetentionRuleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => VisitorRetentionRuleDto)
  visitors?: VisitorRetentionRuleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AuditLogRetentionRuleDto)
  auditLogs?: AuditLogRetentionRuleDto;

  @IsOptional()
  @IsBoolean()
  autoPurgeEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

// ── 2. Backup Schedule DTOs ──────────────────────────────────────────────────
export class UpdateBackupSchedulePolicyDto {
  @IsOptional()
  @IsIn(['DAILY', 'TWICE_DAILY', 'WEEKLY', 'CUSTOM_CRON'])
  frequency?: BackupFrequency;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customCronExpression?: string | null;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'preferredExecutionTimeUtc must be in HH:MM format (24-hour UTC)',
  })
  preferredExecutionTimeUtc?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'secondaryExecutionTimeUtc must be in HH:MM format (24-hour UTC)',
  })
  secondaryExecutionTimeUtc?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  preferredDayOfWeek?: number;

  @IsOptional()
  @IsBoolean()
  includeDatabaseDump?: boolean;

  @IsOptional()
  @IsBoolean()
  includeWalContinuousArchiving?: boolean;

  @IsOptional()
  @IsBoolean()
  includeObjectStorage?: boolean;

  @IsOptional()
  @IsBoolean()
  offsiteReplicationEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

// ── 3. Visitor Hours DTOs ────────────────────────────────────────────────────
export class UpdateVisitorHoursPolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'entryStartTime must be in HH:MM format',
  })
  entryStartTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'entryEndTime must be in HH:MM format',
  })
  entryEndTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'exitDeadlineTime must be in HH:MM format',
  })
  exitDeadlineTime?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(720)
  maxVisitDurationMinutes?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  allowedDaysOfWeek?: number[];

  @IsOptional()
  @IsBoolean()
  allowOvernightStay?: boolean;

  @IsOptional()
  @IsBoolean()
  allowEmergencyOverride?: boolean;

  @IsOptional()
  @IsBoolean()
  requireCnicVerification?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

// ── 4. Physical Delete DTOs ──────────────────────────────────────────────────
export class UpdatePhysicalDeletePolicyDto {
  @IsOptional()
  @IsBoolean()
  allowPhysicalDeletion?: boolean;

  @IsOptional()
  @IsBoolean()
  studentDocumentsPhysicalDeleteAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  residentRecordsPhysicalDeleteAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  admissionRecordsPhysicalDeleteAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  requireOwnerMfaForHardDelete?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

// ── 5. Approval Workflow DTO ─────────────────────────────────────────────────
export class PolicyApprovalActionDto {
  @IsNotEmpty()
  @IsIn(['SUBMIT', 'APPROVE', 'REJECT'])
  action!: 'SUBMIT' | 'APPROVE' | 'REJECT';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

export class VisitorCheckInOverrideDto {
  @IsOptional()
  @IsBoolean()
  isEmergencyOverride?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  overrideReason?: string;
}
