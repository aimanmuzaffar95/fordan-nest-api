import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TaskPriority,
  TaskSource,
  TaskStatus,
} from '../entities/task-status.enum';

export class TaskResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true })
  jobId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Job order number, when the task is job-scoped.',
  })
  jobOrderNumber: string | null;

  @ApiPropertyOptional({ nullable: true })
  customerName: string | null;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiProperty({ enum: TaskStatus })
  status: TaskStatus;

  @ApiProperty({ enum: TaskPriority })
  priority: TaskPriority;

  @ApiProperty({ enum: TaskSource })
  source: TaskSource;

  @ApiPropertyOptional({ nullable: true })
  stage: string | null;

  @ApiPropertyOptional({ nullable: true })
  templateId: string | null;

  @ApiPropertyOptional({ nullable: true })
  assigneeUserId: string | null;

  @ApiPropertyOptional({ nullable: true })
  assigneeName: string | null;

  @ApiPropertyOptional({ nullable: true })
  dueAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  slaDueAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  slaBreachedAt: string | null;

  @ApiProperty({
    description:
      'Whole hours until `slaDueAt` (negative once breached); null when no SLA or the task is closed.',
    nullable: true,
  })
  slaHoursRemaining: number | null;

  @ApiProperty()
  escalationLevel: number;

  @ApiPropertyOptional({ nullable: true })
  escalatedAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  completedAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  createdByUserId: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class TasksListResponseDto {
  @ApiProperty({ type: [TaskResponseDto] })
  items: TaskResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty({
    description:
      'Active tasks whose SLA has breached, within the same filter scope.',
  })
  breachedCount: number;
}
