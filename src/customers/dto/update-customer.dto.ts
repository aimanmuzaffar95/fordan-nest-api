import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CUSTOMER_ACQUISITION_SOURCE_VALUES } from '../constants/customer-acquisition-source.constants';

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

export class UpdateCustomerDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  phone?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  secondaryPhone?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @IsIn(CUSTOMER_ACQUISITION_SOURCE_VALUES)
  acquisitionSource?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  acquisitionSourceOther?: string;

  // ─── Lead attribution (PRD v2, Phase 0) ─────────────────────────────────
  // Pass null to clear a field. Reassigning `leadOwnerUserId` appends to the
  // append-only ownership history — see CustomersService.

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(60)
  leadSource?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(60)
  leadMedium?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(120)
  leadCampaign?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(60)
  leadFormSlug?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(500)
  leadPageReferrer?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(120)
  leadSelfReportedSource?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  leadCapturedAt?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  leadOwnerUserId?: string | null;

  /** Optional note recorded against the ownership-history entry. */
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(200)
  leadOwnerChangeReason?: string | null;

  // ─── Electricity tariff (solar proposal financials) ─────────────────────
  // Pass null to clear a field back to "not captured" (engine defaults
  // apply). Omit the field entirely to leave it unchanged.

  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsNumber()
  @Min(0)
  @Max(5)
  importTariffPerKwh?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsNumber()
  @Min(0)
  @Max(5)
  feedInTariffPerKwh?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsNumber()
  @Min(0)
  @Max(50)
  dailySupplyCharge?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsNumber()
  @Min(0)
  @Max(100000)
  averageMonthlyBill?: number | null;
}
