import {
  Matches,
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
  // A mail login never contains spaces — this catches display names typed into
  // the username field (e.g. "Ahmad (Fordan Dev)"), which cause permanent 535s.
  @Matches(/^\S*$/, {
    message:
      'Mail username cannot contain spaces — leave it blank to use the email address.',
  })
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

  // Full HTML signature, sanitized server-side before storage. Capped so an
  // over-long payload is rejected with 400 rather than truncated.
  @IsString()
  @MaxLength(20000)
  @IsOptional()
  signatureHtml?: string;
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
  // A mail login never contains spaces — this catches display names typed into
  // the username field (e.g. "Ahmad (Fordan Dev)"), which cause permanent 535s.
  @Matches(/^\S*$/, {
    message:
      'Mail username cannot contain spaces — leave it blank to use the email address.',
  })
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

  // undefined = keep current; '' = clear; otherwise sanitized + stored.
  @IsString()
  @MaxLength(20000)
  @IsOptional()
  signatureHtml?: string;
}
