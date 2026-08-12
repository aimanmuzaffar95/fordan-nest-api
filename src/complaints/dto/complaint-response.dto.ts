import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplaintEventType } from '../entities/complaint-event-type.enum';
import {
  ComplaintPriority,
  ComplaintStatus,
} from '../entities/complaint-status.enum';

export class ComplaintEventResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ComplaintEventType })
  type: ComplaintEventType;

  @ApiPropertyOptional({ nullable: true })
  body: string | null;

  @ApiPropertyOptional({ enum: ComplaintStatus, nullable: true })
  statusFrom: ComplaintStatus | null;

  @ApiPropertyOptional({ enum: ComplaintStatus, nullable: true })
  statusTo: ComplaintStatus | null;

  @ApiPropertyOptional({ enum: ComplaintPriority, nullable: true })
  priorityTo: ComplaintPriority | null;

  @ApiPropertyOptional({ nullable: true })
  assigneeFromUserId: string | null;

  @ApiPropertyOptional({ nullable: true })
  assigneeToUserId: string | null;

  @ApiPropertyOptional({ nullable: true })
  actorUserId: string | null;

  @ApiPropertyOptional({ nullable: true })
  actorName: string | null;

  @ApiProperty()
  createdAt: string;
}

export class ComplaintResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  subject: string;

  @ApiProperty({ enum: ComplaintStatus })
  status: ComplaintStatus;

  @ApiProperty({ enum: ComplaintPriority })
  priority: ComplaintPriority;

  @ApiPropertyOptional({ nullable: true })
  customerId: string | null;

  @ApiPropertyOptional({ nullable: true })
  customerName: string | null;

  @ApiPropertyOptional({ nullable: true })
  customerEmail: string | null;

  @ApiPropertyOptional({ nullable: true })
  customerPhone: string | null;

  @ApiPropertyOptional({ nullable: true })
  jobId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Job order number, when linked.',
  })
  jobOrderNumber: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Job pipeline stage, when linked.',
  })
  jobStage: string | null;

  @ApiPropertyOptional({ nullable: true })
  assigneeUserId: string | null;

  @ApiPropertyOptional({ nullable: true })
  assigneeName: string | null;

  @ApiPropertyOptional({ nullable: true })
  createdByUserId: string | null;

  @ApiPropertyOptional({ nullable: true })
  createdByName: string | null;

  @ApiPropertyOptional({ nullable: true })
  solvedAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  closedAt: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiPropertyOptional({
    type: [ComplaintEventResponseDto],
    description: 'Only populated on `GET /complaints/:id` — oldest first.',
  })
  timeline?: ComplaintEventResponseDto[];
}

export class ComplaintsListResponseDto {
  @ApiProperty({ type: [ComplaintResponseDto] })
  items: ComplaintResponseDto[];

  @ApiProperty()
  total: number;
}
