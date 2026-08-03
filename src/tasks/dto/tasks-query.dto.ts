import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TaskPriority, TaskStatus } from '../entities/task-status.enum';

const toInt = ({ value }: { value: unknown }): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

export class TasksQueryDto {
  @ApiPropertyOptional({
    enum: ['mine', 'all'],
    default: 'mine',
    description:
      '`mine` (default) returns tasks assigned to you. `all` returns every task in your visibility scope — admins see all, managers see their managed jobs, installers/employees are always limited to `mine`.',
  })
  @IsOptional()
  @IsIn(['mine', 'all'])
  scope?: 'mine' | 'all';

  @ApiPropertyOptional({
    enum: [...Object.values(TaskStatus), 'active'],
    description: '`active` means open, in progress or blocked.',
  })
  @IsOptional()
  @IsIn([...Object.values(TaskStatus), 'active'])
  status?: TaskStatus | 'active';

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional({ description: 'Pipeline stage key.' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  stage?: string;

  @ApiPropertyOptional({
    description: 'Only tasks whose SLA has already breached.',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  breachedOnly?: 'true' | 'false';

  @ApiPropertyOptional({
    description: 'Only tasks due within the next N hours (still active).',
  })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  dueWithinHours?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(0)
  offset?: number;
}
