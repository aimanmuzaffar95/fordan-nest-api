import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class GetNotificationsQueryDto {
  @ApiPropertyOptional({
    enum: ['all', 'unread'],
    default: 'all',
    description: 'Filter notifications by read state',
  })
  @IsOptional()
  @IsIn(['all', 'unread'])
  status?: 'all' | 'unread';

  @ApiPropertyOptional({
    example: true,
    description:
      'Legacy alias for `status=unread`. When true, unread notifications only are returned.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }

    return value;
  })
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional({
    example: 10,
    default: 10,
    description: 'Maximum number of notifications to return',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
