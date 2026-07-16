import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateMcpAccessKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  // The staff account whose role bounds this key's access.
  @IsUUID()
  boundUserId: string;

  @IsOptional()
  @IsBoolean()
  allowWrites?: boolean;

  @IsOptional()
  @IsISO8601(
    { strict: false },
    { message: 'expiresAt must be an ISO date/time' },
  )
  expiresAt?: string;
}
