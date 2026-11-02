import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  ValidateIf,
} from 'class-validator';
import { TenantStatus, UserStatus } from '@prisma/client';

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{12,128}$/;

export class PlatformPaginationDto {
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
}

export class TenantQueryDto extends PlatformPaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;
}

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ownerFirstName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ownerLastName!: string;

  @IsEmail()
  @MaxLength(254)
  ownerEmail!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  locationAddress!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN)
  ownerPassword!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN)
  ownerPasswordConfirmation!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}

export class UpdateTenantDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ownerFirstName?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ownerLastName?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsEmail()
  @MaxLength(254)
  ownerEmail?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  locationAddress?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}

export class ResetTenantOwnerPasswordDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN)
  newPassword!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN)
  confirmation!: string;
}

export class UpdateTenantStatusDto {
  @IsIn([TenantStatus.ACTIVE, TenantStatus.SUSPENDED])
  status!: 'ACTIVE' | 'SUSPENDED';
}

export class TenantUserQueryDto extends PlatformPaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class UpdateTenantUserDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  roleIds?: string[];
}

export class PlatformLoginBodyDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:\d{6}|[A-Fa-f0-9]{16})$/)
  mfaCode?: string;
}