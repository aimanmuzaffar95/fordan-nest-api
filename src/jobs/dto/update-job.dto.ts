import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { JobMeterStatus, JobStatus, JobSystemType } from '../enums/job.enums';

export class UpdateJobDto {
  @IsUUID()
  @IsOptional()
  customerId?: string;

  @IsUUID()
  @IsOptional()
  managerId?: string | null;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  installerIds?: string[];

  @IsEnum(JobSystemType)
  @IsOptional()
  systemType?: JobSystemType;

  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  contractSigned?: boolean;

  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  depositPaid?: boolean;

  @IsDateString()
  @IsOptional()
  installDate?: string | null;

  @IsEnum(JobMeterStatus)
  @IsOptional()
  preMeterStatus?: JobMeterStatus;

  @IsEnum(JobMeterStatus)
  @IsOptional()
  postMeterStatus?: JobMeterStatus;

  @IsEnum(JobStatus)
  @IsOptional()
  jobStatus?: JobStatus;

  @IsString()
  @MaxLength(10000)
  @IsOptional()
  notes?: string;

  @IsString()
  @MaxLength(10000)
  @IsOptional()
  internalComments?: string;
}
