import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  MinLength,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { InvoiceStatus, PaymentMethod, PaymentStatus } from '@prisma/client';

export type UploadedPaymentProof = {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
};

export class InvoiceLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  unitAmountMinor!: number;
}

export class CreateInvoiceDto {
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  @IsString()
  residentId!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  @ArrayMinSize(1)
  lines!: InvoiceLineDto[];
}

export class InvoiceFilterDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;
}

export class FinanceReportFilterDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

export class RecordPaymentDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  amountMinor!: number;

  @IsUUID('4')
  submissionKey!: string;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  proofNotes?: string;
}

export class SubmitResidentPaymentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  amountMinor!: number;

  @IsUUID('4')
  submissionKey!: string;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  proofNotes?: string;
}

export class ReviewPaymentDto {
  @IsEnum(PaymentStatus)
  status!: PaymentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejectionReason?: string;
}

export class RecordRefundDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  amountMinor!: number;

  @IsUUID('4')
  submissionKey!: string;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
