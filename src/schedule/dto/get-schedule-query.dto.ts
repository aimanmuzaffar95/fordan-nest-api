import { IsDateString } from 'class-validator';

export class GetScheduleQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
