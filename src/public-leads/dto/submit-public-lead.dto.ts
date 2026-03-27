import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** UTM / form slug / referrer — nested so global ValidationPipe whitelist applies reliably. */
export class PublicLeadTrackingDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(80)
  formSlug?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  utmSource?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  utmMedium?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  utmCampaign?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  pageReferrer?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  selfReportedSource?: string;
}

export class SubmitPublicLeadDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(8)
  @MaxLength(30)
  phone: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  suburb?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(20)
  postcode?: string;

  @IsIn(['solar', 'battery', 'both'])
  systemIntent: 'solar' | 'battery' | 'both';

  @IsOptional()
  @IsIn(['residential', 'commercial', 'strata'])
  propertyType?: 'residential' | 'commercial' | 'strata';

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** When `PUBLIC_LEAD_SUBMISSION_SECRET` is set, must match header or this field. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  submissionSecret?: string;

  /** Nested attribution; `@IsObject` + `@ValidateNested` so `whitelist` / `forbidNonWhitelisted` accept this key. */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PublicLeadTrackingDto)
  tracking?: PublicLeadTrackingDto;
}
