import {
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { Job } from './entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity';
import { FindJobsQueryDto } from './dto/find-jobs-query.dto';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { UpdateJobPipelineDto } from './dto/update-job-pipeline.dto';
import { CreateJobDto } from './dto/create-job.dto';

export type JobListViewer = { userId: string; role: UserRole };

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    @InjectRepository(MeterApplication)
    private readonly meterApplicationsRepo: Repository<MeterApplication>,
    @InjectRepository(Customer)
    private readonly customersRepo: Repository<Customer>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async list(query: FindJobsQueryDto, viewer?: JobListViewer) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const qb = this.jobsRepo
      .createQueryBuilder('job')
      .orderBy('job.pipelineStage', 'ASC')
      .addOrderBy('job.pipelinePosition', 'ASC')
      .addOrderBy('job.createdAt', 'DESC');

    if (viewer?.role === UserRole.INSTALLER) {
      const user = await this.usersRepo.findOne({
        where: { id: viewer.userId },
        select: ['id', 'teamId'],
      });
      const teamId = user?.teamId ?? null;
      qb.andWhere(
        new Brackets((sub) => {
          sub.where('job.assignedStaffUserId = :installerUserId', {
            installerUserId: viewer.userId,
          });
          if (teamId) {
            sub.orWhere('job.assignedTeamId = :installerTeamId', {
              installerTeamId: teamId,
            });
          }
        }),
      );
    }

    if (query.customerId) {
      qb.andWhere('job.customerId = :customerId', {
        customerId: query.customerId,
      });
    }

    if (typeof query.contractSigned === 'boolean') {
      qb.andWhere('job.contractSigned = :contractSigned', {
        contractSigned: query.contractSigned,
      });
    }

    qb.skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async getOne(id: string, viewer?: JobListViewer) {
    const job = await this.jobsRepo.findOne({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (viewer?.role === UserRole.INSTALLER) {
      await this.assertInstallerJobAccess(job, viewer.userId);
    }

    return job;
  }

  /** Direct assignment or same team as `assignedTeamId` on the job. */
  private async assertInstallerJobAccess(job: Job, userId: string) {
    if (job.assignedStaffUserId === userId) {
      return;
    }
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      select: ['id', 'teamId'],
    });
    if (
      user?.teamId &&
      job.assignedTeamId &&
      job.assignedTeamId === user.teamId
    ) {
      return;
    }
    throw new NotFoundException('Job not found');
  }

  async updateJobPipeline(
    jobId: string,
    dto: UpdateJobPipelineDto,
    userRole: UserRole,
    userId: string,
  ): Promise<Job> {
    const job = await this.jobsRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');

    const toStage = dto.pipelineStage;

    // Server-side lock enforcement for "installed" transition.
    if (toStage === 'installed' && userRole !== UserRole.ADMIN) {
      const preMeterApproved = await this.meterApplicationsRepo.findOne({
        where: {
          jobId,
          type: 'pre_meter',
          status: 'approved',
        },
      });

      if (!preMeterApproved) {
        throw new PreconditionFailedException({
          message:
            'Cannot move to Installed — approved pre-meter is required (admin may override).',
          code: 'PRECONDITION_FAILED',
        });
      }
    }

    const desiredPosition = dto.pipelinePosition;

    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(max, value));

    return this.dataSource.transaction(async (manager) => {
      const jobRepo = manager.getRepository(Job);
      const timelineRepository = manager.getRepository(TimelineEvent);

      const currentJob = await jobRepo.findOne({ where: { id: jobId } });
      if (!currentJob) throw new NotFoundException('Job not found');

      const actualFromStage = currentJob.pipelineStage;
      const actualToStage = toStage;
      const originalPosition = currentJob.pipelinePosition ?? 0;

      if (actualFromStage === actualToStage) {
        // Reorder within the same stage.
        const jobsInStage = await jobRepo.find({
          where: { pipelineStage: actualToStage },
          order: { pipelinePosition: 'ASC', createdAt: 'DESC' },
        });

        const withoutMoved = jobsInStage
          .map((j) => j.id)
          .filter((id) => id !== jobId);
        const insertionIndex =
          typeof desiredPosition === 'number'
            ? clamp(desiredPosition, 0, withoutMoved.length)
            : withoutMoved.length;

        const newOrder = [
          ...withoutMoved.slice(0, insertionIndex),
          jobId,
          ...withoutMoved.slice(insertionIndex),
        ];

        // Assign sequential positions and keep jobStatus consistent with stage.
        for (let idx = 0; idx < newOrder.length; idx++) {
          await jobRepo.update(
            { id: newOrder[idx] },
            { pipelinePosition: idx, jobStatus: actualToStage },
          );
        }
      } else {
        // Move across stages with stage-local positioning.
        const fromJobs = await jobRepo.find({
          where: { pipelineStage: actualFromStage },
          order: { pipelinePosition: 'ASC', createdAt: 'DESC' },
        });
        const toJobs = await jobRepo.find({
          where: { pipelineStage: actualToStage },
          order: { pipelinePosition: 'ASC', createdAt: 'DESC' },
        });

        const fromIds = fromJobs.map((j) => j.id).filter((id) => id !== jobId);
        const toIds = toJobs.map((j) => j.id).filter((id) => id !== jobId);

        const insertionIndex =
          typeof desiredPosition === 'number'
            ? clamp(desiredPosition, 0, toIds.length)
            : toIds.length;

        const newToOrder = [
          ...toIds.slice(0, insertionIndex),
          jobId,
          ...toIds.slice(insertionIndex),
        ];

        // Update positions for remaining jobs in source stage.
        for (let idx = 0; idx < fromIds.length; idx++) {
          await jobRepo.update(
            { id: fromIds[idx] },
            { pipelinePosition: idx, jobStatus: actualFromStage },
          );
        }

        // Update stage + positions for destination stage jobs (including moved job).
        for (let idx = 0; idx < newToOrder.length; idx++) {
          await jobRepo.update(
            { id: newToOrder[idx] },
            {
              pipelineStage: actualToStage,
              jobStatus: actualToStage,
              pipelinePosition: idx,
            },
          );
        }
      }

      await timelineRepository.save(
        timelineRepository.create({
          jobId,
          type: 'stage_change',
          payload: {
            fromStage: actualFromStage,
            toStage: actualToStage,
            fromPosition: originalPosition,
            toPosition:
              typeof desiredPosition === 'number' ? desiredPosition : null,
          } as unknown,
          createdByUserId: userId,
        }),
      );

      const updated = await jobRepo.findOne({ where: { id: jobId } });
      if (!updated) throw new NotFoundException('Job not found');
      return updated;
    });
  }

  async createJob(
    customerId: string,
    dto: CreateJobDto,
    userRole: UserRole,
    userId: string,
  ): Promise<Job> {
    const customer = await this.customersRepo.findOne({
      where: { id: customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    // Server-side gating: moving/creating as `installed` requires approved pre-meter (admin override only).
    if (dto.pipelineStage === 'installed' && userRole !== UserRole.ADMIN) {
      if (dto.preMeterStatus !== 'approved') {
        throw new PreconditionFailedException({
          message:
            'Cannot create job at Installed — pre-meter must be approved unless acting as admin.',
          code: 'PRECONDITION_FAILED',
        });
      }
    }

    const today = new Date().toISOString().slice(0, 10);

    return this.dataSource.transaction(async (manager) => {
      const jobRepo = manager.getRepository(Job);
      const meterRepo = manager.getRepository(MeterApplication);
      const timelineRepository = manager.getRepository(TimelineEvent);

      const maxInStage = await jobRepo.findOne({
        where: { pipelineStage: dto.pipelineStage },
        order: { pipelinePosition: 'DESC' },
      });

      const nextPipelinePosition =
        dto.pipelinePosition ?? (maxInStage?.pipelinePosition ?? 0) + 1;

      const job = jobRepo.create({
        customerId,
        systemType: dto.systemType,
        systemSizeKw: dto.systemSizeKw.toString(),
        batterySizeKwh:
          typeof dto.batterySizeKwh === 'number'
            ? dto.batterySizeKwh.toString()
            : null,
        projectPrice: dto.projectPrice.toString(),
        contractSigned: dto.contractSigned,
        depositPaid: dto.depositPaid,
        depositAmount: dto.depositAmount.toString(),
        depositDate: dto.depositPaid ? (dto.depositDate ?? today) : null,
        etaCompletionDate: dto.etaCompletionDate ?? null,
        pipelineStage: dto.pipelineStage,
        pipelinePosition: nextPipelinePosition,
        installDate: dto.installDate ?? null,
        jobStatus: dto.pipelineStage,
        invoiceStatus: 'not_invoiced',
        invoiceDate: null,
        invoiceDueDate: null,
        paidDate: null,
        assignedTeamId: null,
        assignedStaffUserId: null,
        scheduledDate: null,
        scheduledSlot: null,
        managerId: null,
      });

      const savedJob = await jobRepo.save(job);

      const createMeter = (type: 'pre_meter' | 'post_meter', status: string) =>
        meterRepo.save(
          meterRepo.create({
            jobId: savedJob.id,
            type,
            status,
            dateSubmitted: today,
            submittedByUserId: userId,
            approvalDate: status === 'approved' ? today : null,
            approvedByUserId: status === 'approved' ? userId : null,
            rejectedAt: status === 'rejected' ? today : null,
            rejectedByUserId: status === 'rejected' ? userId : null,
            rejectionReason: null,
          }),
        );

      await createMeter('pre_meter', dto.preMeterStatus);
      await createMeter('post_meter', dto.postMeterStatus);

      await timelineRepository.save(
        timelineRepository.create({
          jobId: savedJob.id,
          type: 'job_created',
          payload: {
            pipelineStage: savedJob.pipelineStage,
            pipelinePosition: savedJob.pipelinePosition,
          },
          createdByUserId: userId,
        }),
      );

      return savedJob;
    });
  }
}
