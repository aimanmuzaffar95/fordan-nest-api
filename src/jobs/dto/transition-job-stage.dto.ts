import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { JobStatus } from '../enums/job.enums';

export class TransitionJobStageDto {
  @IsEnum(JobStatus)
  toStage: JobStatus;

  @IsOptional()
  @IsBoolean()
  overridePreMeterLock?: boolean;
}
