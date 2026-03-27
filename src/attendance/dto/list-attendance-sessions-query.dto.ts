import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class ListAttendanceSessionsQueryDto {
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ListMyAttendanceSessionsQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
