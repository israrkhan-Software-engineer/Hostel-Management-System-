import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class PlatformLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:\d{6}|[A-Fa-f0-9]{16})$/)
  mfaCode?: string;
}

export class PlatformMfaEnrollmentDto {
  @IsString()
  @MinLength(1)
  enrollmentToken!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}