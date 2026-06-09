import { IsDateString } from 'class-validator';

export class AttendanceSessionsQueryDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
