import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MailAttachmentInput {
  @IsString()
  @MaxLength(255)
  filename: string;

  @IsString()
  @MaxLength(128)
  contentType: string;

  // Raw file base64 (no data: prefix). Combined decoded size is capped in the
  // service (≤ 15MB) — validated there since it needs the whole array.
  @IsString()
  contentBase64: string;
}

export class SendMailDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  to: string[];

  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  @IsOptional()
  cc?: string[];

  @IsString()
  @MaxLength(998)
  subject: string;

  @IsString()
  bodyHtml: string;

  // Default true — the user's signatureHtml is appended when set.
  @IsBoolean()
  @IsOptional()
  appendSignature?: boolean;

  @IsArray()
  @ArrayMaxSize(15)
  @ValidateNested({ each: true })
  @Type(() => MailAttachmentInput)
  @IsOptional()
  attachments?: MailAttachmentInput[];
}

export class UpdateSignatureDto {
  @IsString()
  @MaxLength(20000)
  signatureHtml: string;
}
