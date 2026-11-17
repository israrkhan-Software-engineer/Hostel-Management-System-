import { Transform } from 'class-transformer';
import { IsString, IsNotEmpty, MinLength, IsOptional, Matches } from 'class-validator';

const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class LoginDto {
  @Transform(trimString)
  @IsString() @IsNotEmpty()
  tenantSlug!: string;

  @Transform(trimString)
  @IsString() @IsNotEmpty()
  login!: string; // email or phone

  @Transform(trimString)
  @IsString() @MinLength(8)
  password!: string;

  @Transform(trimString)
  @IsString() @IsOptional()
  deviceInfo?: string;

  @Transform(trimString)
  @IsOptional() @IsString()
  @Matches(/^(?:\d{6}|[A-Fa-f0-9]{16})$/)
  mfaCode?: string;
}

export class RefreshDto {
  @Transform(trimString)
  @IsOptional() @IsString()
  refreshToken?: string;
}

export class LogoutDto {
  @Transform(trimString)
  @IsOptional() @IsString()
  refreshToken?: string;
}

export class InitiateResetDto {
  @Transform(trimString)
  @IsString() @IsNotEmpty()
  tenantSlug!: string;

  @Transform(trimString)
  @IsString() @IsNotEmpty()
  login!: string; // email or phone
}

export class CompleteResetDto {
  @Transform(trimString)
  @IsString() @IsNotEmpty()
  token!: string;

  @Transform(trimString)
  @IsString() @MinLength(8)
  newPassword!: string;
}

export class BeginMfaEnrollmentDto {
  @Transform(trimString)
  @IsString() @MinLength(8)
  password!: string;
}

export class CompleteMfaEnrollmentDto {
  @Transform(trimString)
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class ChangePasswordDto {
  @Transform(trimString)
  @IsString()
  @MinLength(12)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{12,128}$/)
  newPassword!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  currentPassword!: string;
}
