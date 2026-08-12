import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ComplaintPriority } from '../entities/complaint-status.enum';

export class CreateComplaintDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(1)
  @MaxLength(200)
  subject: string;

  @ApiProperty({
    maxLength: 10000,
    description:
      'The complaint body — becomes the first `created` timeline event.',
  })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(1)
  @MaxLength(10000)
  body: string;

  @ApiPropertyOptional({
    enum: ComplaintPriority,
    default: ComplaintPriority.NORMAL,
  })
  @IsOptional()
  @IsEnum(ComplaintPriority)
  priority?: ComplaintPriority;

  @ApiPropertyOptional({ description: 'Customer this complaint is about.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  customerId?: string | null;

  @ApiPropertyOptional({ description: 'Job this complaint relates to.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  jobId?: string | null;

  @ApiPropertyOptional({
    description: 'Assignee user id; omit to leave unassigned.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  assigneeUserId?: string | null;
}
