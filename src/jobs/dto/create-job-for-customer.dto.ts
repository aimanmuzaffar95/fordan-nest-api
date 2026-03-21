import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
  ValidateIf,
} from 'class-validator';
import { JobPipelineStage } from '../job-pipeline-stage.enum';
import { JobSystemType } from '../job-system-type.enum';

export class CreateJobForCustomerDto {
  @IsEnum(JobSystemType)
  systemType: JobSystemType;

  @ValidateIf(
    (dto: CreateJobForCustomerDto) =>
      dto.systemType === JobSystemType.SOLAR ||
      dto.systemType === JobSystemType.BOTH,
  )
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  systemSizeKw?: number;

  @ValidateIf(
    (dto: CreateJobForCustomerDto) =>
      dto.systemType === JobSystemType.BATTERY ||
      dto.systemType === JobSystemType.BOTH,
  )
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  batterySizeKwh?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  contractSigned?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  depositPaid?: boolean;

  @ValidateIf((dto: CreateJobForCustomerDto) => dto.depositPaid === true)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  depositAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  projectPrice?: number;

  @IsOptional()
  @IsDateString()
  installDate?: string;

  @IsOptional()
  @IsEnum(JobPipelineStage)
  jobStatus?: JobPipelineStage;
}
