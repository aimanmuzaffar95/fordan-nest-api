import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  MilestoneStatus,
  MilestoneType,
} from '../entities/project-milestone.entity';
import { IsNotFutureDate } from '../validators/is-not-future-date';

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

export class UpsertMilestoneDto {
  @ApiProperty({ enum: MilestoneType })
  @IsEnum(MilestoneType)
  type: MilestoneType;

  @ApiPropertyOptional({
    description:
      'Update a specific attempt. Omit to advance the latest — a closed attempt starts a new one so correction history survives.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({
    enum: MilestoneStatus,
    description: '`failed` requires a correction list.',
  })
  @IsOptional()
  @IsEnum(MilestoneStatus)
  status?: MilestoneStatus;

  @ApiPropertyOptional({ description: 'Council, utility or network operator.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(160)
  authorityName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(100)
  referenceNumber?: string | null;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  targetDate?: string | null;

  @ApiPropertyOptional({ description: 'ISO 8601.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  scheduledAt?: string | null;

  @ApiPropertyOptional({
    description:
      'YYYY-MM-DD. When the gate actually passed/failed — cannot be in the future.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  @IsNotFutureDate()
  completedDate?: string | null;

  @ApiPropertyOptional({ description: 'Required when recording a failure.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(4000)
  correctionList?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
