import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BillingInterval, DepositTransactionType, DiscountType, LateFeeType } from '@prisma/client';

export class CreateFeeStructureDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsEnum(BillingInterval)
  interval!: BillingInterval;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  amountMinor!: number;
}

export class AssignFeeDto {
  @IsUUID('4')
  residentId!: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

export class CreateFeeInvoiceDto {
  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

export class CreateLateFeeSettingDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  daysAfterDue!: number;

  @IsEnum(LateFeeType)
  feeType!: LateFeeType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  amount!: number;
}

export class CreateStudentDiscountDto {
  @IsUUID('4')
  residentId!: string;

  @IsEnum(DiscountType)
  type!: DiscountType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  value!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

export class CreateDepositTransactionDto {
  @IsUUID('4')
  residentId!: string;

  @IsEnum(DepositTransactionType)
  type!: DepositTransactionType;

  @Type(() => Number)
  @IsInt()
  @Min(-2_147_483_647)
  @Max(2_147_483_647)
  amountMinor!: number;

  @IsUUID('4')
  submissionKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
