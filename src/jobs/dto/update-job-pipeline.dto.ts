import { Transform } from 'class-transformer';
import { IsInt, IsIn, IsOptional, Max, Min } from 'class-validator';

const VALID_PIPELINE_STAGES = [
  'lead',
  'quoted',
  'won',
  'pre_meter_submitted',
  'pre_meter_approved',
  'scheduled',
  'installed',
  'post_meter_submitted',
  'completed',
  'invoiced',
  'paid',
] as const;

export class UpdateJobPipelineDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsIn([...VALID_PIPELINE_STAGES])
  pipelineStage!: (typeof VALID_PIPELINE_STAGES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  pipelinePosition?: number;
}
