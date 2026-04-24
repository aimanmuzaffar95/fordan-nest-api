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

export class CreateComplianceTemplateDto {
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
