import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AlertResponseDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'uuid-job-5678' })
  jobId: string;

  @ApiProperty({ example: 'PRE_METER_PENDING_7_DAYS' })
  type: string;

  @ApiProperty({ example: 'high' })
  severity: string;

  @ApiProperty({
    example:
      'Pre-meter not approved and install date is approaching for job uuid-job-5678',
  })
  message: string;

  @ApiProperty({ example: '2026-04-01T00:00:00.000Z' })
  createdAt: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  resolvedAt: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  resolvedByUserId: string | null;
}

export class AlertsListResponseDto {
  @ApiProperty({ type: [AlertResponseDto] })
  items: AlertResponseDto[];

  @ApiProperty({ example: 5 })
  total: number;
}
