import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  DefectSeverity,
  DefectStatus,
  InstallVisitStatus,
} from '../entities/install-visit.entity';

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

export class UpsertInstallVisitDto {
  @ApiPropertyOptional({ description: 'Omit to start a new visit.' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({
    enum: InstallVisitStatus,
    description:
      '`partial` requires `outstandingWork`; `aborted` requires `abortReason`.',
  })
  @IsOptional()
  @IsEnum(InstallVisitStatus)
  status?: InstallVisitStatus;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  scheduledDate?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID(undefined, { each: true })
  crewUserIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  leadInstallerUserId?: string | null;

  @ApiPropertyOptional({ description: '0–100.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(0)
  @Max(100)
  completionPercent?: number | null;

  @ApiPropertyOptional({ description: 'Required when status is `partial`.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  outstandingWork?: string | null;

  @ApiPropertyOptional({ description: 'Required when status is `aborted`.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(200)
  abortReason?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpsertDefectDto {
  @ApiPropertyOptional({ description: 'Omit to raise a new defect.' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ description: 'Required when raising a new defect.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ enum: DefectSeverity })
  @IsOptional()
  @IsEnum(DefectSeverity)
  severity?: DefectSeverity;

  @ApiPropertyOptional({
    enum: DefectStatus,
    description:
      '`waived` requires a reason and is refused for `critical` defects.',
  })
  @IsOptional()
  @IsEnum(DefectStatus)
  status?: DefectStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  installVisitId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  assignedUserId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  resolutionNotes?: string | null;

  @ApiPropertyOptional({ description: 'Required when waiving.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(200)
  waiverReason?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  photoFileIds?: string[];
}
