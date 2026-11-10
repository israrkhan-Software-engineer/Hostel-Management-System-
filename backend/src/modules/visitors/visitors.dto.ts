import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

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

  @IsUUID()
  hostResidentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  purpose!: string;
}
