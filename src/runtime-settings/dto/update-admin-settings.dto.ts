import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateAdminSettingsDto {
  @IsOptional()
  @IsBoolean()
  overridePreMeter?: boolean;

  @IsOptional()
  @IsBoolean()
  calendarScopeEnforced?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(1)
  @Max(365)
  invoiceOverdueDays?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(1)
  @Max(365)
  preMeterPendingDays?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  @Max(365)
  installWarningDays?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  @Max(365)
  postMeterDeadlineDays?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  quickLeadDefaultSystemSizeKw?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  quickLeadDefaultBatterySizeKwh?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  quickLeadDefaultProjectPrice?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    if (typeof value === 'string') return value.trim();
    return undefined;
  })
  @ValidateIf((_, v) => v != null)
  @MaxLength(512)
  @IsUrl({ require_tld: false, require_protocol: true })
  esignPublicBaseUrl?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(1)
  @Max(90)
  esignTokenTtlDays?: number;

  @IsOptional()
  @IsBoolean()
  complianceRequireSignature?: boolean;

  @IsOptional()
  @Transform(({ value }: { value: unknown }): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    if (typeof value === 'string') return value.trim();
    return undefined;
  })
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(255)
  smtpHost?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    if (typeof value === 'string') return value.trim();
    return undefined;
  })
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(255)
  smtpUser?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    if (typeof value === 'string') return value;
    return undefined;
  })
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(512)
  smtpPass?: string | null;

  @IsOptional()
  @IsBoolean()
  smtpSecure?: boolean | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    if (typeof value === 'string') return value.trim();
    return undefined;
  })
  @ValidateIf((_, v) => v != null)
  @IsEmail()
  @MaxLength(320)
  mailFrom?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    if (typeof value === 'string') return value.trim();
    return undefined;
  })
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(200)
  mailFromName?: string | null;

  @IsOptional()
  @IsObject()
  customerMessagingTemplates?: Record<string, unknown>;
}
