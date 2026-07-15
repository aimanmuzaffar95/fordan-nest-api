import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AttendanceLocationDto } from './attendance-location.dto';

export class GlobalClockInDto extends AttendanceLocationDto {
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @IsOptional()
  @IsUUID()
  assignmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  offSiteAcknowledgedReason?: string;
}

export class GlobalClockOutDto extends AttendanceLocationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  offSiteAcknowledgedReason?: string;
}
