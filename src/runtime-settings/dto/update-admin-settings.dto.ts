import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateAdminSettingsDto {
  @IsOptional()
  @IsBoolean()
  overridePreMeter?: boolean;

  @IsOptional()
  @IsBoolean()
  calendarScopeEnforced?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  invoiceOverdueDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  preMeterPendingDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  installWarningDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  postMeterDeadlineDays?: number;
}
