import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { Job } from './entities/job.entity';

/**
 * Soft-delete jobs inside an open transaction. Shared by DELETE /jobs/:id and
 * DELETE /customers/:id (which cascades to the customer's jobs).
 *
 * Rules:
 * - Refuses (409 JOB_HAS_INVOICES) when any of the jobs has an invoice —
 *   finance records must keep pointing at a visible job.
 * - Hard-deletes the jobs' schedule assignments. Assignments are slots, not
 *   records of value, and every schedule read dereferences `assignment.job`,
 *   which would be null once the job is soft-deleted.
 * - Writes a `job_deleted` timeline event per job (auditability).
 */
export async function softDeleteJobs(
  manager: EntityManager,
  jobs: Job[],
  actorUserId: string,
): Promise<void> {
  if (jobs.length === 0) return;
  const jobIds = jobs.map((job) => job.id);

  const invoiced = await manager
    .getRepository(Invoice)
    .createQueryBuilder('invoice')
    .where('invoice.jobId IN (:...jobIds)', { jobIds })
    .getCount();
  if (invoiced > 0) {
    throw new ConflictException({
      message:
        'This job has invoices. Cancel or delete the invoices before deleting the job.',
      code: 'JOB_HAS_INVOICES',
    });
  }

  await manager
    .getRepository(Assignment)
    .createQueryBuilder()
    .delete()
    .where('jobId IN (:...jobIds)', { jobIds })
    .execute();

  const timeline = manager.getRepository(TimelineEvent);
  await timeline.save(
    jobs.map((job) =>
      timeline.create({
        jobId: job.id,
        type: 'job_deleted',
        payload: { orderNumber: job.orderNumber, stage: job.pipelineStage },
        createdByUserId: actorUserId,
      }),
    ),
  );

  await manager.getRepository(Job).softDelete(jobIds);
}
