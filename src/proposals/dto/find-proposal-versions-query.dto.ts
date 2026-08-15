import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ProposalStatus } from '../entities/proposal-version.entity';

/**
 * Query for `GET /proposal-versions` — the cross-job index. Mirrors the
 * page/pageSize convention `apiFetchAllPages` expects (see
 * `QueryInvoicesDto`/`FindJobsQueryDto`).
 */
export class FindProposalVersionsQueryDto {
  @IsOptional()
  @IsEnum(ProposalStatus)
  status?: ProposalStatus;

  /** Inclusive lower bound on `sentAt` (ISO 8601). */
  @IsOptional()
  @IsDateString()
  sentFrom?: string;

  /** Inclusive upper bound on `sentAt` (ISO 8601). */
  @IsOptional()
  @IsDateString()
  sentTo?: string;

  /** Free text across customer name and job order number. */
  @IsOptional()
  @IsString()
  search?: string;

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
  pageSize?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
