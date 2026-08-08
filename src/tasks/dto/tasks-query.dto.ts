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

/**
 * Whitelisted, strictly validated — never interpolated into raw SQL. Keep in
 * sync with the `switch` in `TasksService`'s sort builder.
 */
export const TASK_SORT_FIELDS = [
  'slaDueAt',
  'jobOrderNumber',
  'assignee',
  'createdAt',
  'priority',
  'status',
] as const;

export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

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

  @ApiPropertyOptional({
    enum: TASK_SORT_FIELDS,
    description:
      'Column to sort by. Defaults to the SLA queue order (`slaDueAt` ASC, `createdAt` DESC) when omitted.',
  })
  @IsOptional()
  @IsIn(TASK_SORT_FIELDS)
  sortBy?: TaskSortField;

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'ASC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortDir?: 'ASC' | 'DESC';
}
