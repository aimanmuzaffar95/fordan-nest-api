import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
} from 'class-validator';
import { CUSTOMER_ACQUISITION_SOURCE_VALUES } from '../constants/customer-acquisition-source.constants';

const trimOrUndefined = ({ value }: { value: unknown }): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export class CreateCustomerDto {
  @ApiProperty({ example: 'Jane' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({ example: '12 Solar St' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ example: -33.8688 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: 151.2093 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiProperty({ example: '+61400000000' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  phone: string;

  @ApiPropertyOptional({ example: '+61400000001' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  secondaryPhone?: string;

  @ApiProperty({ example: 'jane@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({
    enum: CUSTOMER_ACQUISITION_SOURCE_VALUES,
    example: 'social_media',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsIn(CUSTOMER_ACQUISITION_SOURCE_VALUES)
  acquisitionSource: string;

  @ApiPropertyOptional({
    example: 'Local community WhatsApp group',
    description: 'Required when acquisitionSource is "other".',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  acquisitionSourceOther?: string;

  // ─── Lead attribution (PRD v2, Phase 0) ─────────────────────────────────
  // Normally set by the public lead form; exposed here so imports and manual
  // lead entry can record the same provenance.

  @ApiPropertyOptional({ example: 'website_form' })
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  leadSource?: string;

  @ApiPropertyOptional({ example: 'cpc' })
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  leadMedium?: string;

  @ApiPropertyOptional({ example: 'spring-solar-2026' })
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  leadCampaign?: string;

  @ApiPropertyOptional({ example: 'default' })
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  leadFormSlug?: string;

  @ApiPropertyOptional({ example: 'https://example.com/solar' })
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  leadPageReferrer?: string;

  @ApiPropertyOptional({ example: 'Saw your van in the street' })
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  leadSelfReportedSource?: string;

  @ApiPropertyOptional({ description: 'ISO 8601; defaults to now.' })
  @IsOptional()
  @IsDateString()
  leadCapturedAt?: string;

  @ApiPropertyOptional({ description: 'Owning sales rep.' })
  @IsOptional()
  @IsUUID()
  leadOwnerUserId?: string;
}
