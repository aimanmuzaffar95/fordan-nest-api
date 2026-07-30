import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsDecimalFractionString } from '../validators/is-decimal-fraction-string';
import { IsPositiveDecimalString } from '../validators/is-positive-decimal-string';

class CreateInvoiceItemDto {
  @IsString()
  @MaxLength(255)
  description: string;

  @IsPositiveDecimalString()
  quantity: string;

  @IsPositiveDecimalString()
  unitPrice: string;

  @IsDecimalFractionString()
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

  @IsIn(['deposit', 'final', 'custom'])
  @IsOptional()
  type?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
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
