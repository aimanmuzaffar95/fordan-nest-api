import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Per-note cap — generous for a timeline entry, small enough to keep rows sane. */
export const PROJECT_NOTE_MAX_LENGTH = 4000;

export class CreateProjectNoteDto {
  @ApiProperty({
    example: 'Customer requested the install crew call ahead by 30 minutes.',
    maxLength: PROJECT_NOTE_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(PROJECT_NOTE_MAX_LENGTH)
  body: string;
}
