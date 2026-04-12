import { JobPipelineStage } from './job-pipeline-stage.enum';
import { Job } from './entities/job.entity';

/**
 * Ordered list of pipeline stages. Index = stage rank.
 * A move from a higher index to a lower index is a "backwards" move.
 */
export const STAGE_ORDER: JobPipelineStage[] = [
  JobPipelineStage.LEAD,
  JobPipelineStage.QUOTED,
  JobPipelineStage.WON,
  JobPipelineStage.PRE_METER_SUBMITTED,
  JobPipelineStage.PRE_METER_APPROVED,
  JobPipelineStage.SCHEDULED,
  JobPipelineStage.INSTALLED,
  JobPipelineStage.POST_METER_SUBMITTED,
  JobPipelineStage.COMPLETED,
  JobPipelineStage.INVOICED,
  JobPipelineStage.PAID,
];

/**
 * Returns an error message string if the forward gate is not satisfied,
 * or null if the move is allowed.
 */
export const FORWARD_GATE_RULES: Partial<
  Record<JobPipelineStage, (job: Job) => string | null>
> = {
  [JobPipelineStage.QUOTED]: (job) => {
    if (!job.projectPrice || Number(job.projectPrice) <= 0) {
      return 'A project price must be set before moving to Quoted.';
    }
    return null;
  },
  [JobPipelineStage.WON]: (job) => {
    if (!job.contractSigned) {
      return 'The contract must be marked as signed before moving to Won.';
    }
    return null;
  },
  [JobPipelineStage.SCHEDULED]: (job) => {
    if (!job.installDate) {
      return 'An install date must be set before scheduling.';
    }
    return null;
  },
};

export function isBackwardsMove(
  fromStage: JobPipelineStage,
  toStage: JobPipelineStage,
): boolean {
  const fromIndex = STAGE_ORDER.indexOf(fromStage);
  const toIndex = STAGE_ORDER.indexOf(toStage);
  return toIndex < fromIndex;
}
