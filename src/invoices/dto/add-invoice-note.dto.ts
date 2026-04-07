import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddInvoiceNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note: string;
}
