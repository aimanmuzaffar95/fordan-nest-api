import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { JobPipelineStage } from '../job-pipeline-stage.enum';

export class TransitionJobStageDto {
  @IsEnum(JobPipelineStage)
  toStage: JobPipelineStage;

  @IsOptional()
  @IsBoolean()
  overridePreMeterLock?: boolean;
}
