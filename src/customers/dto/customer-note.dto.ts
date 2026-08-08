import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Per-note cap — matches `project_notes` (`PROJECT_NOTE_MAX_LENGTH`). */
export const CUSTOMER_NOTE_MAX_LENGTH = 4000;

export class CreateCustomerNoteDto {
  @ApiProperty({
    example: 'Gate code is 925. Dog in yard — keep gate closed.',
    maxLength: CUSTOMER_NOTE_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOMER_NOTE_MAX_LENGTH)
  body: string;

  @ApiPropertyOptional({
    description: 'Pin this note to the top of the customer note list.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}
