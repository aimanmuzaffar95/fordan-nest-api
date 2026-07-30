import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMailboxDto {
  @IsUUID()
  userId: string;

  @IsEmail()
  @MaxLength(255)
  emailAddress: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  username?: string;

  @IsString()
  @MinLength(1)
  password: string;

  @IsString()
  @MaxLength(255)
  imapHost: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  imapPort?: number;

  @IsBoolean()
  @IsOptional()
  imapSecure?: boolean;

  @IsString()
  @MaxLength(255)
  smtpHost: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  smtpPort?: number;

  @IsBoolean()
  @IsOptional()
  smtpSecure?: boolean;
}

export class UpdateMailboxDto {
  @IsUUID()
  @IsOptional()
  userId?: string;

  @IsEmail()
  @MaxLength(255)
  @IsOptional()
  emailAddress?: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  username?: string;

  // Omitted / empty = keep the current password.
  @IsString()
  @IsOptional()
  password?: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  imapHost?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  imapPort?: number;

  @IsBoolean()
  @IsOptional()
  imapSecure?: boolean;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  smtpHost?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  smtpPort?: number;

  @IsBoolean()
  @IsOptional()
  smtpSecure?: boolean;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
