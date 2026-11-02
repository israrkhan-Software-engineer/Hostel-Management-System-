import { IsString, IsNotEmpty, MinLength, IsOptional } from 'class-validator';

export class LoginDto {
  @IsString() @IsNotEmpty()
  tenantSlug!: string;

  @IsString() @IsNotEmpty()
  login!: string; // email or phone

  @IsString() @MinLength(8)
  password!: string;

  @IsString() @IsOptional()
  deviceInfo?: string;
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
