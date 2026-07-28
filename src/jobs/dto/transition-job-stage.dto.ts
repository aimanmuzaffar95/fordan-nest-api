import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { JobPipelineStage } from '../job-pipeline-stage.enum';

export class TransitionJobStageDto {
  @IsEnum(JobPipelineStage)
  toStage: JobPipelineStage;

  /**
   * Retained for API compatibility. The pre-meter lock on `installed` is now
   * enforced identically by both stage-change routes (record-based gate);
   * admins already bypass it, so this flag is a no-op.
   */
  @IsOptional()
  @IsBoolean()
  overridePreMeterLock?: boolean;

  /**
   * Required by the shared transition method for a backward stage move
   * (5–500 chars). Same contract as PATCH :id/pipeline.
   */
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  backstageReason?: string;

  @IsOptional()
  @IsDateString()
  preMeterSubmittedDate?: string;

  @IsOptional()
  @IsDateString()
  postMeterSubmittedDate?: string;
}
