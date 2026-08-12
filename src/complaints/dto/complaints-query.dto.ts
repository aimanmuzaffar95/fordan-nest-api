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
import {
  ComplaintPriority,
  ComplaintStatus,
} from '../entities/complaint-status.enum';

const toInt = ({ value }: { value: unknown }): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

export class ComplaintsQueryDto {
  @ApiPropertyOptional({ enum: ComplaintStatus })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  @ApiPropertyOptional({ enum: ComplaintPriority })
  @IsOptional()
  @IsEnum(ComplaintPriority)
  priority?: ComplaintPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional({
    enum: ['mine', 'all'],
    default: 'mine',
    description:
      '`mine` returns complaints assigned to you. `all` (admin/manager default) returns every complaint in your visibility scope. Installers are always limited to `mine`.',
  })
  @IsOptional()
  @IsIn(['mine', 'all'])
  scope?: 'mine' | 'all';

  @ApiPropertyOptional({
    enum: ['unsolved', 'unassigned'],
    description:
      '`unsolved` = status in new|open|pending|on_hold. `unassigned` = unsolved AND assignee IS NULL. Takes precedence over a single `status` filter when set.',
  })
  @IsOptional()
  @IsIn(['unsolved', 'unassigned'])
  view?: 'unsolved' | 'unassigned';

  @ApiPropertyOptional({ description: 'Case-insensitive subject search.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

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
