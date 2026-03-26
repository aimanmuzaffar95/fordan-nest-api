import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BatteryStockStatus } from '../entities/battery-stock-status.enum';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimOptionalString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export class CreateBatteryDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  brand!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  model!: string;

  @IsNumber()
  @Min(0.01)
  capacityKwh!: number;

  @IsNumber()
  @Min(0)
  defaultUnitPrice!: number;

  @IsEnum(BatteryStockStatus)
  stockStatus!: BatteryStockStatus;

  @IsOptional()
  @IsNumber()
  @Min(0)
  voltage?: number;

  @IsOptional()
  @Transform(trimOptionalString)
  @IsString()
  @MaxLength(50)
  chemistry?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  cycleLife?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  warrantyYears?: number;

  @IsOptional()
  @Transform(trimOptionalString)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
