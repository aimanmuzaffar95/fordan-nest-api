import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ComplianceFieldDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{0,62}$/)
  key: string;

  @IsString()
  @MaxLength(500)
  label: string;

  @IsString()
  @IsIn(['text', 'checkbox', 'date'])
  type: 'text' | 'checkbox' | 'date';

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export const COMPLIANCE_CATEGORIES = [
  'checklist',
  'sop',
  'training',
  'safety',
] as const;
export const COMPLIANCE_PHASES = [
  'pre_install',
  'install',
  'post_install',
  'handover',
  'any',
] as const;
export const EVIDENCE_SOURCES = ['camera', 'gallery', 'document'] as const;

export class ComplianceEvidenceDto {
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsArray()
  @IsIn(EVIDENCE_SOURCES as unknown as string[], { each: true })
  sources?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(20)
  min?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  max?: number;
}

export class CreateComplianceTemplateDto {
  @IsOptional()
  @IsIn(COMPLIANCE_CATEGORIES as unknown as string[])
  category?: string;

  @IsOptional()
  @IsIn(COMPLIANCE_PHASES as unknown as string[])
  phase?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  instructions?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ComplianceEvidenceDto)
  evidence?: ComplianceEvidenceDto | null;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComplianceFieldDto)
  fields: ComplianceFieldDto[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-10_000)
  @Max(10_000)
  sortOrder?: number;
}

export class UpdateComplianceTemplateDto {
  @IsOptional()
  @IsIn(COMPLIANCE_CATEGORIES as unknown as string[])
  category?: string;

  @IsOptional()
  @IsIn(COMPLIANCE_PHASES as unknown as string[])
  phase?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  instructions?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ComplianceEvidenceDto)
  evidence?: ComplianceEvidenceDto | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComplianceFieldDto)
  fields?: ComplianceFieldDto[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-10_000)
  @Max(10_000)
  sortOrder?: number;
}
