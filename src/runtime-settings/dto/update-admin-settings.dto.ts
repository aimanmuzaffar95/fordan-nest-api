import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ATTENDANCE_GEOFENCE_MODES } from '../../attendance/attendance-geofence-mode';

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

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxJobsPerTeamPerDay?: number;

  @IsOptional()
  @IsIn([...ATTENDANCE_GEOFENCE_MODES])
  attendanceGeofenceMode?: (typeof ATTENDANCE_GEOFENCE_MODES)[number];

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(2000)
  attendanceGeofenceRadiusMeters?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(500)
  attendanceMaxGpsAccuracyMeters?: number;
}
