import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ComplaintStatus } from '../entities/complaint-status.enum';

export class CreateComplaintMessageDto {
  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(1)
  @MaxLength(10000)
  body: string;

  @ApiProperty({
    enum: ['reply', 'note'],
    description:
      '`reply` is customer-facing; `note` is staff-only (HubSpot reply/note split).',
  })
  @IsIn(['reply', 'note'])
  visibility: 'reply' | 'note';

  @ApiPropertyOptional({
    enum: ComplaintStatus,
    description:
      'Optionally move the complaint to this status in the same request (HubSpot reply+status pattern). Same transition rules as `PATCH /complaints/:id` apply.',
  })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;
}
