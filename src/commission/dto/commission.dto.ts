import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  CommissionEventType,
  CommissionStatus,
} from '../entities/commission-event.entity';

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

export class CreateCommissionEventDto {
  @ApiProperty({ description: 'Who earned it.' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: CommissionEventType })
  @IsEnum(CommissionEventType)
  eventType: CommissionEventType;

  @ApiProperty({
    description:
      'Negative only for `adjustment` and `clawback`; positive otherwise.',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-10000000)
  @Max(10000000)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ default: 'AUD' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({
    description: 'Required whenever `ratePercent` is supplied.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  basisAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100)
  ratePercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(120)
  planName?: string | null;

  @ApiPropertyOptional({ description: 'The event a clawback reverses.' })
  @IsOptional()
  @IsUUID()
  reversesEventId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdateCommissionEventDto {
  @ApiPropertyOptional({
    enum: CommissionStatus,
    description: '`void` and `clawed_back` require a reason.',
  })
  @IsOptional()
  @IsEnum(CommissionStatus)
  status?: CommissionStatus;

  @ApiPropertyOptional({ description: 'Refused once the record is paid.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-10000000)
  @Max(10000000)
  amount?: number;

  @ApiPropertyOptional({ description: 'Refused once the record is paid.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  basisAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(60)
  payoutReference?: string | null;

  @ApiPropertyOptional({ description: 'Required to void or claw back.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(200)
  reason?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class RecordPayoutDto {
  @ApiProperty({ type: [String], description: 'Approved records to pay.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  eventIds: string[];

  @ApiProperty({ description: 'Groups these events as one payout run.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(60)
  payoutReference: string;
}

export class CommissionQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional({ enum: CommissionStatus })
  @IsOptional()
  @IsIn(Object.values(CommissionStatus))
  status?: CommissionStatus;
}
