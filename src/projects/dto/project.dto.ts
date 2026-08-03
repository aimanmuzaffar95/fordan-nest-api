import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ProjectStage } from '../entities/project.entity';

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

export class UpdateProjectDto {
  @ApiPropertyOptional({
    enum: ProjectStage,
    description:
      'Gated: `scheduled` requires a complete readiness checklist, `pto` requires an install date, and an installed project cannot move back.',
  })
  @IsOptional()
  @IsEnum(ProjectStage)
  stage?: ProjectStage;

  @ApiPropertyOptional({ description: 'Required when moving to `on_hold`.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(200)
  holdReason?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  projectManagerUserId?: string | null;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  targetInstallDate?: string | null;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  actualInstallDate?: string | null;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  targetPtoDate?: string | null;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  actualPtoDate?: string | null;

  @ApiPropertyOptional({
    description:
      'Partial map of readiness item id → done. Merged, not replaced.',
  })
  @IsOptional()
  @IsObject()
  readinessChecklist?: Record<string, boolean>;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}

export class ReadinessItemDto {
  @IsString()
  id: string;

  @IsBoolean()
  done: boolean;
}
