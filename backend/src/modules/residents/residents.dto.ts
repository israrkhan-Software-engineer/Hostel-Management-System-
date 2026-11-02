import {
  IsEnum,
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AdmissionStatus } from '@prisma/client';

const PERSON_NAME_PATTERN = /^(?=.*\p{L})[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u;

export class CreateResidentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(PERSON_NAME_PATTERN, {
    message: 'Name must contain letters and may include spaces, hyphens, or apostrophes',
  })
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(PERSON_NAME_PATTERN, {
    message: 'Name must contain letters and may include spaces, hyphens, or apostrophes',
  })
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string;

  @IsOptional()
  @Matches(/^\d{5}-?\d{7}-?\d$/)
  cnic?: string;
}

export class UpdateResidentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(PERSON_NAME_PATTERN, {
    message: 'Name must contain letters and may include spaces, hyphens, or apostrophes',
  })
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(PERSON_NAME_PATTERN, {
    message: 'Name must contain letters and may include spaces, hyphens, or apostrophes',
  })
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string;
}

export class UpdateMyResidentProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(PERSON_NAME_PATTERN, {
    message: 'Name must contain letters and may include spaces, hyphens, or apostrophes',
  })
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(PERSON_NAME_PATTERN, {
    message: 'Name must contain letters and may include spaces, hyphens, or apostrophes',
  })
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string | null;
}

export class CreateAdmissionDto {
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  residentId!: string;

  @IsOptional()
  @IsDateString()
  requestedCheckInAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateAdmissionDto {
  @IsOptional()
  @IsDateString()
  requestedCheckInAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class AdmissionDecisionDto {
  @Matches(/^(APPROVED|REJECTED)$/)
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejectionReason?: string;
}

export class AllocateBedDto {
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  bedId!: string;
}

export class AdmissionFilterDto {
  @IsOptional()
  @IsEnum(AdmissionStatus)
  status?: AdmissionStatus;
}
