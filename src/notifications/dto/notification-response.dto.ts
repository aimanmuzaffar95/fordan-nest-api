import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NotificationResponseDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'JOB_ASSIGNED_TO_INSTALLER' })
  type: string;

  @ApiProperty({ example: 'New installer assignment' })
  title: string;

  @ApiPropertyOptional({
    example: 'You were assigned to job ORD-1001 for Ali Khan.',
    nullable: true,
  })
  body: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  metadata: Record<string, unknown> | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  readAt: string | null;

  @ApiProperty({ example: '2026-04-06T10:00:00.000Z' })
  createdAt: string;
}

export class NotificationsListResponseDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  items: NotificationResponseDto[];

  @ApiProperty({ example: 10 })
  total: number;
}

export class NotificationUnreadCountResponseDto {
  @ApiProperty({ example: 3 })
  unreadCount: number;
}
