import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { RoutingStrategy } from '../entities/territory.entity';

const trimOrNull = ({
  value,
}: {
  value: unknown;
}): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const cleanStringArray = ({
  value,
}: {
  value: unknown;
}): string[] | undefined =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter((v) => v !== ''),
        ),
      )
    : undefined;

export class TerritoryMemberDto {
  @ApiProperty()
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({ default: 1, description: 'Share under `weighted`.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  weight?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateTerritoryDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'Claimed postcodes.' })
  @IsOptional()
  @Transform(cleanStringArray)
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  postcodes?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Suburb/region names matched against the address.',
  })
  @IsOptional()
  @Transform(cleanStringArray)
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  regions?: string[];

  @ApiPropertyOptional({ enum: RoutingStrategy })
  @IsOptional()
  @IsEnum(RoutingStrategy)
  routingStrategy?: RoutingStrategy;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  ownerUserId?: string | null;

  @ApiPropertyOptional({
    description: 'Hours before an untouched lead is reassigned. Null disables.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(1)
  @Max(8760)
  reassignAfterHours?: number | null;

  @ApiPropertyOptional({ default: 100, description: 'Lower wins on ties.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  priority?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: [TerritoryMemberDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TerritoryMemberDto)
  members?: TerritoryMemberDto[];
}

export class UpdateTerritoryDto extends CreateTerritoryDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  declare name: string;
}

export class PreviewRoutingDto {
  @ApiPropertyOptional({ description: 'Free-text address to match.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(255)
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(12)
  postcode?: string | null;
}
