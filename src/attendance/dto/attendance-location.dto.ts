import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  Min,
} from 'class-validator';
import { ATTENDANCE_LOCATION_STATUSES } from '../attendance-location-status.enum';

export class AttendanceLocationDto {
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  accuracyM?: number | null;

  @IsEnum(ATTENDANCE_LOCATION_STATUSES)
  locationStatus: (typeof ATTENDANCE_LOCATION_STATUSES)[number];
}
