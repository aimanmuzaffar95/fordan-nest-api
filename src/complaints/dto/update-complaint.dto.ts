import { ApiPropertyOptional } from '@nestjs/swagger';
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
import {
  ComplaintPriority,
  ComplaintStatus,
} from '../entities/complaint-status.enum';

export class UpdateComplaintDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({
    enum: ComplaintStatus,
    description:
      'Cannot move back to `new` once left, and cannot be changed once `closed`.',
  })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  @ApiPropertyOptional({ enum: ComplaintPriority })
  @IsOptional()
  @IsEnum(ComplaintPriority)
  priority?: ComplaintPriority;

  @ApiPropertyOptional({ description: 'Pass null to unassign.' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  assigneeUserId?: string | null;
}
