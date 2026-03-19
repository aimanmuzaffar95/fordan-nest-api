import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsPositiveDecimalString } from '../validators/is-positive-decimal-string';

class CreateInvoiceItemDto {
  @IsString()
  @MaxLength(255)
  description: string;

  @IsPositiveDecimalString()
  quantity: string;

  @IsPositiveDecimalString()
  unitPrice: string;

  @IsPositiveDecimalString()
  @IsOptional()
  taxRate?: string;
}

export class CreateInvoiceDto {
  // Either `customerId` (legacy) OR `jobId` (order/job-based) must be provided.
  @IsUUID()
  @IsOptional()
  customerId?: string;

  @IsUUID()
  @IsOptional()
  jobId?: string;

  @IsString()
  @Length(3, 10)
  currency: string;

  @IsDateString()
  issueDate: string;

  @IsDateString()
  dueDate: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  terms?: string;
}
