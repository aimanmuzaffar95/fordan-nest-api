import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class GetScheduleQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;
}
