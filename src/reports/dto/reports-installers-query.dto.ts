import { IsDateString, IsOptional } from 'class-validator';

export class ReportsInstallersQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
