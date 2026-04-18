import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateJobDto {
  @IsOptional()
  @IsIn(['solar', 'battery', 'both'])
  systemType?: 'solar' | 'battery' | 'both';

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === '') return null;
    if (typeof value === 'string') return Number(value);
    return value;
  })
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  systemSizeKw?: number | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === '') return null;
    if (typeof value === 'string') return Number(value);
    return value;
  })
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  batterySizeKwh?: number | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? Number(value) : value,
  )
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  projectPrice?: number;

  @IsOptional()
  @IsBoolean()
  contractSigned?: boolean;

  @IsOptional()
  @IsBoolean()
  depositPaid?: boolean;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? Number(value) : value,
  )
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  depositAmount?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === '') return null;
    return value;
  })
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  installDate?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === '') return null;
    return value;
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  managerId?: string | null;
}
