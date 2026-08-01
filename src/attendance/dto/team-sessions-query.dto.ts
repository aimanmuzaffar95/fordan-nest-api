import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class TeamSessionsQueryDto {
  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  @IsUUID()
  @IsOptional()
  userId?: string;
}
