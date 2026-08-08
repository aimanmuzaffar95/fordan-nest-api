import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { InvoiceStatus } from '../entities/invoice-status.enum';

export class QueryInvoicesDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

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

  /**
   * Opt-in: when set to 'full', the list response embeds each invoice's
   * items/payments/activities (same shape as GET /invoices/:id), so callers
   * that need the full graph for every row on a page can avoid N+1 detail
   * fetches. Omitted/any other value keeps the existing lightweight
   * (invoice + customer only) response unchanged.
   */
  @IsOptional()
  @IsString()
  include?: string;
}
