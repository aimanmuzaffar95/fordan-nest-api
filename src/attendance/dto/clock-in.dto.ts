import { Type } from 'class-transformer';
import { IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { AttendanceLocationDto } from './attendance-location.dto';

export class ClockInDto {
  @IsOptional()
  @IsUUID('4')
  jobId?: string;

  @IsOptional()
  @IsUUID('4')
  assignmentId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AttendanceLocationDto)
  location?: AttendanceLocationDto;

  @IsOptional()
  offSiteAcknowledgedReason?: string;
}
