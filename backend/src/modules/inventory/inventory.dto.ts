import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CreateBuildingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class CreateFloorDto {
  @Matches(UUID_PATTERN)
  buildingId!: string;

  @IsInt()
  @Min(-2)
  @Max(100)
  level!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class CreateRoomDto {
  @Matches(UUID_PATTERN)
  floorId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  bedCapacity!: number;
}

export class CreateBedDto {
  @Matches(UUID_PATTERN)
  roomId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;
}
