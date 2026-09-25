import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

export class GrantAdminAccessDto {
  @ApiProperty({
    description:
      'When the temporary admin access lapses (ISO 8601). Must be in the future and at most 30 days out.',
    example: '2026-10-09T00:00:00.000Z',
  })
  @IsISO8601()
  until!: string;
}
