import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  BillingInterval,
  PlatformInvoiceStatus,
  PlatformPaymentMethod,
  SubscriptionStatus,
} from '@prisma/client';

export class UpsertSubscriptionPlanDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  monthlyPriceMinor?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  yearlyPriceMinor?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  userLimit?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  branchLimit?: number;

  @IsOptional()
  @IsObject()
  features?: Record<string, boolean>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AssignSubscriptionDto {
  @IsUUID('4')
  planId!: string;

  @IsIn([BillingInterval.MONTHLY, BillingInterval.YEARLY])
  billingInterval!: typeof BillingInterval.MONTHLY | typeof BillingInterval.YEARLY;

  @IsOptional()
  @IsIn([SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE])
  status?: typeof SubscriptionStatus.TRIAL | typeof SubscriptionStatus.ACTIVE;
}

export class ChangeSubscriptionStatusDto {
  @IsIn([SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED, SubscriptionStatus.CANCELLED])
  status!: typeof SubscriptionStatus.ACTIVE | typeof SubscriptionStatus.SUSPENDED | typeof SubscriptionStatus.CANCELLED;
}

export class UpdateTrialSettingsDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  trialPlanId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  notifyDaysBefore?: number;
}

export class RecordPlatformPaymentDto {
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  amountMinor!: number;

  @IsEnum(PlatformPaymentMethod)
  method!: PlatformPaymentMethod;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class SubscriptionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @IsOptional()
  @IsEnum(PlatformInvoiceStatus)
  status?: PlatformInvoiceStatus;
}
