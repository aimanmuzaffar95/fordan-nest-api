import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class AlertsQueryDto {
  @ApiPropertyOptional({
    enum: ['active', 'resolved', 'all'],
    default: 'active',
    description: 'Filter alerts by resolution status',
  })
  @IsOptional()
  @IsIn(['active', 'resolved', 'all'])
  status?: 'active' | 'resolved' | 'all';

  @ApiPropertyOptional({
    enum: ['high', 'medium', 'low'],
    description: 'Filter alerts by severity',
  })
  @IsOptional()
  @IsIn(['high', 'medium', 'low'])
  severity?: 'high' | 'medium' | 'low';

  @ApiPropertyOptional({
    example: 'PRE_METER_PENDING_7_DAYS',
    description: 'Filter alerts by type',
  })
  @IsOptional()
  @IsString()
  type?: string;
}
