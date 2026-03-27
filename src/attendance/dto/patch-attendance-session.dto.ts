import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class PatchAttendanceSessionDto {
  @IsOptional()
  @IsDateString()
  clockInAt?: string;

  @IsOptional()
  @IsDateString()
  clockOutAt?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  correctionNote?: string;
}
