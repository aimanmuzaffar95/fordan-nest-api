import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  CommunicationChannel,
  CommunicationDirection,
  CommunicationStatus,
} from '../entities/communication-log.entity';

const trimOrNull = ({
  value,
}: {
  value: unknown;
}): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export class LogCommunicationDto {
  @ApiProperty()
  @IsUUID()
  customerId: string;

  @ApiPropertyOptional({
    description: 'Links the entry into the job timeline.',
  })
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiProperty({ enum: CommunicationChannel })
  @IsEnum(CommunicationChannel)
  channel: CommunicationChannel;

  @ApiProperty({ enum: CommunicationDirection })
  @IsEnum(CommunicationDirection)
  direction: CommunicationDirection;

  @ApiPropertyOptional({
    enum: CommunicationStatus,
    description: 'Defaults from channel and direction.',
  })
  @IsOptional()
  @IsEnum(CommunicationStatus)
  status?: CommunicationStatus;

  @ApiPropertyOptional({
    description: 'Number or address on the customer side.',
  })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(320)
  counterparty?: string | null;

  @ApiPropertyOptional({
    description: 'SMS body, call summary or meeting notes.',
  })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(4000)
  body?: string | null;

  @ApiPropertyOptional({ description: 'Call length in seconds.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  durationSeconds?: number;

  @ApiPropertyOptional({ description: 'Provider message/call id.' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(120)
  externalId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(60)
  providerName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(200)
  failureReason?: string | null;

  @ApiPropertyOptional({
    description: 'ISO 8601 — when it happened, not when it was recorded.',
  })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class UpdateCommunicationStatusDto {
  @ApiProperty({ enum: CommunicationStatus })
  @IsEnum(CommunicationStatus)
  status: CommunicationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(200)
  failureReason?: string | null;
}
