import { IsString, IsNotEmpty, MinLength, IsOptional, Matches } from 'class-validator';

export class LoginDto {
  @IsString() @IsNotEmpty()
  tenantSlug!: string;

  @IsString() @IsNotEmpty()
  login!: string; // email or phone

  @IsString() @MinLength(8)
  password!: string;

  @IsString() @IsOptional()
  deviceInfo?: string;

  @IsOptional() @IsString()
  @Matches(/^(?:\d{6}|[A-Fa-f0-9]{16})$/)
  mfaCode?: string;
}

export class RefreshDto {
  @IsOptional() @IsString()
  refreshToken?: string;
}

export class LogoutDto {
  @IsOptional() @IsString()
  refreshToken?: string;
}

export class InitiateResetDto {
  @IsString() @IsNotEmpty()
  tenantSlug!: string;

  @IsString() @IsNotEmpty()
  login!: string; // email or phone
}

export class CompleteResetDto {
  @IsString() @IsNotEmpty()
  token!: string;

  @IsString() @MinLength(8)
  newPassword!: string;
}

export class BeginMfaEnrollmentDto {
  @IsString() @MinLength(8)
  password!: string;
}

export class CompleteMfaEnrollmentDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(12)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{12,128}$/)
  newPassword!: string;

  @IsString()
  @MinLength(1)
  currentPassword!: string;
}
