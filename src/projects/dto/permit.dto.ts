import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PermitStatus } from '../entities/permit.entity';

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

export class CreatePermitDto {
  @ApiProperty({
    example: 'electrical',
    description: 'Free text — permit vocabularies differ by market.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(60)
  permitType: string;

  @ApiProperty({ example: 'City of Melbourne' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(160)
  authorityName: string;

  @ApiPropertyOptional({ enum: PermitStatus })
  @IsOptional()
  @IsEnum(PermitStatus)
  status?: PermitStatus;

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
  targetSubmissionDate?: string | null;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  targetApprovalDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  feeAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdatePermitDto {
  @ApiPropertyOptional({
    enum: PermitStatus,
    description:
      '`revision_requested` increments the revision counter; `rejected` requires a reason.',
  })
  @IsOptional()
  @IsEnum(PermitStatus)
  status?: PermitStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(60)
  permitType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(160)
  authorityName?: string;

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
  targetSubmissionDate?: string | null;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  submittedDate?: string | null;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  targetApprovalDate?: string | null;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  approvedDate?: string | null;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  expiryDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  revisionNotes?: string | null;

  @ApiPropertyOptional({ description: 'Required when rejecting.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(200)
  rejectionReason?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  feeAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
