import { Transform, Type } from 'class-transformer';
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
  registerDecorator,
  ValidationArguments,
} from 'class-validator';
import { TenantStatus, UserStatus } from '@prisma/client';

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{12,128}$/;

function MatchField(fieldName: string, message?: string) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'matchField',
      target: target.constructor,
      propertyName,
      constraints: [fieldName],
      options: { message: message ?? `${propertyName} must match ${fieldName}` },
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const object = args.object as Record<string, unknown>;
          return value === object[fieldName];
        },
      },
    });
  };
}

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
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ownerFirstName!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ownerLastName!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  ownerEmail!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  locationAddress!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN)
  ownerPassword!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN)
  @MatchField('ownerPassword')
  ownerPasswordConfirmation!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  timezone?: string;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}

export class UpdateTenantDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ownerFirstName?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ownerLastName?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsEmail()
  @MaxLength(254)
  ownerEmail?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  locationAddress?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  timezone?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}

export class ResetTenantOwnerPasswordDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN)
  newPassword!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN)
  @MatchField('newPassword')
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