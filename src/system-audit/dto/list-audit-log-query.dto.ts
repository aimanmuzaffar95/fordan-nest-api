import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
  Max,
  Min,
} from 'class-validator';

export class ListAuditLogQueryDto {
  /**
   * Prefix match on `action`, e.g. `auth.` or a full action string like
   * `admin_settings.updated`.
   */
  @IsOptional()
  @MaxLength(96)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'action may only contain letters, digits, ".", "_" and "-"',
  })
  action?: string;

  /** Inclusive start day (YYYY-MM-DD or ISO date-time) on createdAt. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Inclusive end day (YYYY-MM-DD or ISO date-time) on createdAt. */
  @IsOptional()
  @IsDateString()
  to?: string;

  /** Filter by acting user (actorUserId column). */
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;
}
