import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  MealAttendanceStatus,
  MessMealType,
  StudentAttendanceStatus,
  StudentDocumentCategory,
} from '@prisma/client';

export class AttendanceEntryDto {
  @IsUUID()
  residentId!: string;

  @IsEnum(StudentAttendanceStatus)
  status!: StudentAttendanceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class MarkAttendanceDto {
  @IsDateString()
  date!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  records!: AttendanceEntryDto[];
}

export class AttendanceQueryDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  residentId?: string;

  @IsOptional()
  @IsEnum(MessMealType)
  meal?: MessMealType;
}

export class CreateLeaveRequestDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}

export class DecideLeaveRequestDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateStudentGatePassDto {
  @IsDateString()
  exitAt!: string;

  @IsDateString()
  expectedReturnAt!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class DecideStudentGatePassDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @ValidateIf((dto: DecideStudentGatePassDto) => dto.status === 'REJECTED')
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  rejectionReason?: string;
}

export class MealAttendanceEntryDto {
  @IsUUID()
  residentId!: string;

  @IsEnum(MealAttendanceStatus)
  status!: MealAttendanceStatus;
}

export class MarkMealAttendanceDto {
  @IsDateString()
  date!: string;

  @IsEnum(MessMealType)
  meal!: MessMealType;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MealAttendanceEntryDto)
  records!: MealAttendanceEntryDto[];
}

export class CreateMealPlanDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  monthlyAmountMinor!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsEnum(MessMealType, { each: true })
  mealTypes!: MessMealType[];
}

export class SetMealPlanActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

export class CreateMealSubscriptionDto {
  @IsUUID()
  planId!: string;

  @IsDateString()
  startsOn!: string;

  @IsDateString()
  endsOn!: string;
}

export class UploadStudentDocumentDto {
  @IsEnum(StudentDocumentCategory)
  category!: StudentDocumentCategory;
}

export class RoomTransferDto {
  @IsUUID()
  toBedId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class RoomTransferQueryDto {
  @IsOptional()
  @IsUUID()
  residentId?: string;
}

export class ExportFilterDto {
  @IsOptional()
  @IsIn(['residents', 'admissions', 'attendance', 'finance'])
  dataset?: 'residents' | 'admissions' | 'attendance' | 'finance';

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
