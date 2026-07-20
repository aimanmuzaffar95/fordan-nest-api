import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsPositiveDecimalString } from '../validators/is-positive-decimal-string';

/**
 * Allowed payment methods. Mirrors the values the clients send:
 * web `PaymentMethod` (apps/web src/data/models.ts) and the mobile
 * record-payment sheet (bank_transfer / credit_card / cash / cheque).
 */
export const INVOICE_PAYMENT_METHODS = [
  'bank_transfer',
  'credit_card',
  'cash',
  'cheque',
  'other',
] as const;

export type InvoicePaymentMethod = (typeof INVOICE_PAYMENT_METHODS)[number];

export class RecordPaymentDto {
  @IsPositiveDecimalString()
  amount: string;

  @IsDateString()
  paymentDate: string;

  @IsString()
  @IsIn(INVOICE_PAYMENT_METHODS)
  method: InvoicePaymentMethod;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  reference?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
