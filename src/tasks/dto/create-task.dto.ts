import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TaskPriority } from '../entities/task-status.enum';

const trimOrNull = ({
  value,
}: {
  value: unknown;
}): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export class CreateTaskDto {
  @ApiPropertyOptional({ description: 'Job this task belongs to.' })
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MaxLength(160)
  title: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ enum: TaskPriority, default: TaskPriority.NORMAL })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({
    description: 'Assignee user id; omit to leave for triage.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  assigneeUserId?: string | null;

  @ApiPropertyOptional({ description: 'ISO 8601 due timestamp.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  dueAt?: string | null;

  @ApiPropertyOptional({
    description: 'ISO 8601 SLA deadline. Defaults to `dueAt` when omitted.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  slaDueAt?: string | null;

  @ApiPropertyOptional({ description: 'Pipeline stage this task relates to.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(50)
  stage?: string | null;
}
