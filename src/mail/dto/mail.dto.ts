import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

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
}

export class UpdateSignatureDto {
  @IsString()
  @MaxLength(20000)
  signatureHtml: string;
}
