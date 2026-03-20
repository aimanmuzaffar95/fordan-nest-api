import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsInt,
  Min,
  IsDateString,
} from 'class-validator';

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

const VALID_METER_STATUSES = ['pending', 'approved', 'rejected'] as const;

export class CreateJobDto {
  @IsIn(['solar', 'battery', 'both'])
  systemType!: 'solar' | 'battery' | 'both';

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNumber()
  @Min(0)
  systemSizeKw!: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === '' ? null : value))
  @IsNumber()
  @Min(0)
  batterySizeKwh?: number;

  @IsNumber()
  @Min(0)
  projectPrice!: number;

  @IsBoolean()
  contractSigned!: boolean;

  @IsBoolean()
  depositPaid!: boolean;

  @IsNumber()
  @Min(0)
  depositAmount!: number;

  @IsOptional()
  @IsDateString()
  depositDate?: string | null;

  @IsOptional()
  @IsDateString()
  etaCompletionDate?: string | null;

  @IsOptional()
  @IsDateString()
  installDate?: string | null;

  @IsIn([...VALID_PIPELINE_STAGES])
  pipelineStage!: (typeof VALID_PIPELINE_STAGES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  pipelinePosition?: number;

  // Initial meter states created together with the job.
  @IsIn([...VALID_METER_STATUSES])
  preMeterStatus!: (typeof VALID_METER_STATUSES)[number];

  @IsIn([...VALID_METER_STATUSES])
  postMeterStatus!: (typeof VALID_METER_STATUSES)[number];
}
