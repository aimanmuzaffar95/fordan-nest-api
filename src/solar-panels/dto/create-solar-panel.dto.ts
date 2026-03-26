import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsInt,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SolarPanelStockStatus } from '../entities/solar-panel-stock-status.enum';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimOptionalString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export class CreateSolarPanelDto {
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
  wattage!: number;

  @IsNumber()
  @Min(0)
  defaultUnitPrice!: number;

  @IsEnum(SolarPanelStockStatus)
  stockStatus!: SolarPanelStockStatus;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  efficiency?: number;

  @IsOptional()
  @Transform(trimOptionalString)
  @IsString()
  @MaxLength(120)
  dimensions?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number;

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
