import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { IsPositiveDecimalString } from '../validators/is-positive-decimal-string';

export class RecordPaymentDto {
  @IsPositiveDecimalString()
  amount: string;

  @IsDateString()
  paymentDate: string;

  @IsString()
  @IsNotEmpty()
  method: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
