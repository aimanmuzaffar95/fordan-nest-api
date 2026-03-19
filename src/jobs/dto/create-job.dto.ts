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

export class CreateJobDto {
  @IsUUID()
  customerId: string;

  @IsUUID()
  managerId: string;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  installerIds?: string[];

  @IsEnum(JobSystemType)
  systemType: JobSystemType;

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
  installDate?: string;

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
