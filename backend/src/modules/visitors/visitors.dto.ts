import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateVisitorVisitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @Matches(/^(?=.*\p{L})[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u, {
    message: 'Visitor name must contain letters and may include spaces, hyphens, or apostrophes',
  })
  visitorName!: string;

  @Matches(/^\d{5}-?\d{7}-?\d$/)
  cnic!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  visitorPhone?: string;

  @IsOptional()
  @IsUUID()
  hostResidentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  manualHostName?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  purpose!: string;

  @IsOptional()
  @IsBoolean()
  isEmergencyOverride?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  overrideReason?: string;
}

export class CheckInVisitorDto {
  @IsOptional()
  @IsBoolean()
  isEmergencyOverride?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  overrideReason?: string;
}
