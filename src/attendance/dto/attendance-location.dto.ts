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

/**
 * NOTE (BE-ATTEND-02): latitude/longitude/accuracy and `locationStatus` are
 * CLIENT-REPORTED. There is no way to cryptographically verify GPS coordinates
 * originating from a device — a determined client can spoof any value. The
 * server therefore treats these as advisory: it only validates that they fall
 * within plausible geographic bounds (`@IsLatitude` = -90..90,
 * `@IsLongitude` = -180..180) and records them as-supplied. Any trust decision
 * (e.g. the geofence off-site flag) is computed server-side from these
 * client-reported inputs, not asserted by the client.
 */
export class AttendanceLocationDto {
  // Bounded to -90..90; client-reported, treated as advisory (see note above).
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number | null;

  // Bounded to -180..180; client-reported, treated as advisory (see note above).
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
