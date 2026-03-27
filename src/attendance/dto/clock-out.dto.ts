import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { AttendanceLocationDto } from './attendance-location.dto';

export class ClockOutDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AttendanceLocationDto)
  location?: AttendanceLocationDto;

  @IsOptional()
  offSiteAcknowledgedReason?: string;
}
