import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { SurveyOutcome, SurveyStatus } from '../entities/site-survey.entity';

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

export const ROOF_TYPES = [
  'tile',
  'metal',
  'colorbond',
  'slate',
  'concrete',
  'other',
] as const;
export const SHADING_LEVELS = ['none', 'light', 'moderate', 'heavy'] as const;
export const PHASE_TYPES = ['single', 'three'] as const;
export const ACCESS_DIFFICULTIES = ['easy', 'moderate', 'difficult'] as const;

export class UpsertSurveyDto {
  @ApiPropertyOptional({ description: 'Update an existing survey by id.' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated id from the mobile offline queue. Replaying the same id updates rather than duplicating.',
  })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(64)
  clientRequestId?: string | null;

  @ApiPropertyOptional({ enum: SurveyStatus })
  @IsOptional()
  @IsEnum(SurveyStatus)
  status?: SurveyStatus;

  @ApiPropertyOptional({ enum: SurveyOutcome })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsEnum(SurveyOutcome)
  outcome?: SurveyOutcome | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  assignedUserId?: string | null;

  @ApiPropertyOptional({ description: 'ISO 8601.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  scheduledAt?: string | null;

  // ─── Roof ───────────────────────────────────────────────────────────────

  @ApiPropertyOptional({ enum: ROOF_TYPES })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsIn(ROOF_TYPES as unknown as string[])
  roofType?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(0)
  @Max(200)
  roofAgeYears?: number | null;

  @ApiPropertyOptional({ description: 'Degrees, 0–90.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(0)
  @Max(90)
  roofPitchDegrees?: number | null;

  @ApiPropertyOptional({ description: 'Compass degrees, 0–359.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(0)
  @Max(359)
  roofOrientationDegrees?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(1)
  @Max(10)
  storeys?: number | null;

  @ApiPropertyOptional({ description: 'Usable area in m².' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  usableRoofAreaSqm?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsBoolean()
  roofConditionAcceptable?: boolean | null;

  // ─── Shading ────────────────────────────────────────────────────────────

  @ApiPropertyOptional({ enum: SHADING_LEVELS })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsIn(SHADING_LEVELS as unknown as string[])
  shadingLevel?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(1000)
  shadingNotes?: string | null;

  // ─── Switchboard ────────────────────────────────────────────────────────

  @ApiPropertyOptional({ enum: PHASE_TYPES })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsIn(PHASE_TYPES as unknown as string[])
  phaseType?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsBoolean()
  switchboardUpgradeRequired?: boolean | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(1000)
  switchboardNotes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(0)
  @Max(2000)
  mainSwitchRatingAmps?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(0)
  @Max(5000)
  cableRunMetres?: number | null;

  // ─── Access ─────────────────────────────────────────────────────────────

  @ApiPropertyOptional({ enum: ACCESS_DIFFICULTIES })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsIn(ACCESS_DIFFICULTIES as unknown as string[])
  accessDifficulty?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsBoolean()
  scaffoldRequired?: boolean | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsBoolean()
  craneRequired?: boolean | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(1000)
  accessNotes?: string | null;

  // ─── Outcome ────────────────────────────────────────────────────────────

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  outcomeNotes?: string | null;

  @ApiPropertyOptional({ description: 'Extra cost the survey uncovered.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000000)
  remediationCost?: number | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Uploaded photo file ids.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  photoFileIds?: string[];

  @ApiPropertyOptional({ description: 'Free-form answers.' })
  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>;
}
