import { ApiPropertyOptional } from '@nestjs/swagger';
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
import { TaskPriority, TaskStatus } from '../entities/task-status.enum';

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

export class UpdateTaskDto {
  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ enum: TaskStatus })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: 'Pass null to unassign.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  assigneeUserId?: string | null;

  @ApiPropertyOptional({ description: 'ISO 8601; pass null to clear.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  dueAt?: string | null;

  @ApiPropertyOptional({
    description:
      'ISO 8601 SLA deadline. Admin/manager only — changing it resets the breach state.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  slaDueAt?: string | null;
}
