import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PricingMode } from '../entities/proposal-version.entity';

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

export class CreateProposalVersionDto {
  @ApiPropertyOptional({ enum: PricingMode, default: PricingMode.CASH })
  @IsOptional()
  @IsEnum(PricingMode)
  pricingMode?: PricingMode;

  @ApiPropertyOptional({
    description:
      'Omit rather than send 0 for "not priced yet" — persisted as `null`, not `0.00`, so it never presents as an agreed price.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  totalPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  depositAmount?: number;

  @ApiPropertyOptional({ description: 'STC/rebate value applied.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  rebateAmount?: number;

  @ApiPropertyOptional({ description: 'Annual rate, e.g. 6.99.' })
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
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  monthlyPayment?: number;

  @ApiPropertyOptional({ description: 'PPA price per kWh.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  ppaRatePerKwh?: number;

  @ApiPropertyOptional({ description: 'Frozen line items as shown.' })
  @IsOptional()
  @IsObject()
  lineItemsSnapshot?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Frozen system configuration.' })
  @IsOptional()
  @IsObject()
  systemSnapshot?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ description: 'ISO 8601 expiry.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  expiresAt?: string | null;
}

export class SendProposalDto {
  @ApiPropertyOptional({ description: 'Recipient, for the audit trail.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @ApiPropertyOptional({ description: 'ISO 8601; overrides the draft expiry.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  expiresAt?: string | null;
}

export class DeclineProposalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(200)
  reason?: string | null;
}
