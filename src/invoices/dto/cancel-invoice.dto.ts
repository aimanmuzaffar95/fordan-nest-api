import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelInvoiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
