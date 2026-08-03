import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { FinancingStatus } from '../entities/financing-application.entity';

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

export class CreateFinancingApplicationDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  lenderName: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(120)
  productName?: string | null;

  @ApiPropertyOptional({ description: 'The lender’s own reference.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(100)
  externalReference?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  requestedAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100)
  interestRatePercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  termMonths?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdateFinancingApplicationDto {
  @ApiPropertyOptional({
    enum: FinancingStatus,
    description:
      'Transitions are validated. `approved` requires `approvalExpiresAt`; `declined` requires `declineReason`.',
  })
  @IsOptional()
  @IsEnum(FinancingStatus)
  status?: FinancingStatus;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  lenderName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(120)
  productName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(100)
  externalReference?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  requestedAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  approvedAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100)
  interestRatePercent?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(1)
  @Max(600)
  termMonths?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  monthlyPayment?: number | null;

  @ApiPropertyOptional({ description: 'ISO 8601. Required when approving.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  approvalExpiresAt?: string | null;

  @ApiPropertyOptional({ description: 'Required when declining.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(200)
  declineReason?: string | null;

  @ApiPropertyOptional({ description: 'What the lender is waiting on.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  outstandingRequirements?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
