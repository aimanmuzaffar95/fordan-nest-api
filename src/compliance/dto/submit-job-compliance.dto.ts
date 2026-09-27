import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SubmitJobComplianceDto {
  @IsUUID('all')
  templateId: string;

  @IsObject()
  answers: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(6_000_000)
  signaturePngBase64?: string;

  /** `files` ids already uploaded to this job with kind `compliance`. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  evidenceFileIds?: string[];
}
