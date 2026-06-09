import {
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class GenerateJobDocumentDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^doc_[a-z0-9_]+$/, {
    message: 'templateId must be a known document template slug (doc_*)',
  })
  templateId: string;

  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;
}
