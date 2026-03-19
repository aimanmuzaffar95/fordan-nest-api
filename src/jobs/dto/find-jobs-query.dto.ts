import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class FindJobsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'undefined' ? undefined : Number(value),
  )
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsUUID()
  @IsOptional()
  managerId?: string;

  @IsUUID()
  @IsOptional()
  installerId?: string;

  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'undefined') return undefined;
    const normalized = String(value).trim().toLowerCase();
    return ['true', '1', 'yes', 'y', 'on'].includes(normalized);
  })
  @IsBoolean()
  @IsOptional()
  includeDeleted?: boolean;
}
