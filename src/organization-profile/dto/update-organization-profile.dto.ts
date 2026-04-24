import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateOrganizationProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  tradingName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  registeredAddressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  registeredAddressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @IsOptional()
  @IsBoolean()
  billingSameAsRegistered?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  billingAddressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  billingAddressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  billingCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  billingState?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  billingPostalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  billingCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  taxIdPrimary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  taxIdSecondary?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  defaultCurrency?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  defaultTimezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  documentsContactName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  documentsContactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  documentsContactPhone?: string;
}
