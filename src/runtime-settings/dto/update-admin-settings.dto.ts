import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsNumber,
  Max,
  MaxLength,
  Min,
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
  @IsString()
  @MaxLength(253)
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @IsOptional()
  @IsBoolean()
  smtpSecure?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  smtpUser?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  smtpPass?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  mailFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  mailFromName?: string;
}
