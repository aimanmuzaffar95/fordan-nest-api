import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { JobAuditLogsService } from './job-audit-logs.service';
import { JobAuditAction } from './job-audit-action.enum';
import { CreateJobForCustomerDto } from './dto/create-job-for-customer.dto';
import { JobDetailResponseDto } from './dto/job-detail-response.dto';
import { JobPipelineStage } from './job-pipeline-stage.enum';
import { JobSystemType } from './job-system-type.enum';
import { JobAuditLog } from './entities/job-audit-log.entity';
import { Job } from './entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity';
import { FindJobsQueryDto } from './dto/find-jobs-query.dto';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { Note } from '../notes/entities/note.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { UpdateJobPipelineDto } from './dto/update-job-pipeline.dto';
import { CreateJobDto } from './dto/create-job.dto';

export type JobListViewer = { userId: string; role: UserRole };

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    private readonly dataSource: DataSource,
    private readonly jobAuditLogs: JobAuditLogsService,
    @InjectRepository(MeterApplication)
    private readonly meterApplicationsRepo: Repository<MeterApplication>,
    @InjectRepository(Customer)
    private readonly customersRepo: Repository<Customer>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Note)
    private readonly notesRepo: Repository<Note>,
  ) {}

  async list(query: FindJobsQueryDto, viewer?: JobListViewer) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? query.limit ?? 20;

    const qb = this.jobsRepo
      .createQueryBuilder('job')

      .leftJoinAndSelect('job.customer', 'customer')
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

  private async findOneOrFail(
    jobsRepo: Repository<Job>,
    id: string,
    viewer?: JobListViewer,
  ) {
    const job = await jobsRepo.findOne({
      where: { id },
      relations: {
        customer: true,
      },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (viewer?.role === UserRole.INSTALLER) {
      await this.assertInstallerJobAccess(job, viewer.userId);
    }

    return job;
  }

  async getOne(id: string, viewer?: JobListViewer) {
    const job = await this.findOneOrFail(this.jobsRepo, id, viewer);
    const timeline = await this.dataSource.getRepository(JobAuditLog).find({
      where: { jobId: id },
      relations: {
        performedBy: true,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    return this.mapJobDetail(job, timeline);
  }

  async createForCustomer(
    performedById: string | null,
    customerId: string,
    dto: CreateJobForCustomerDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const customerRepo = manager.getRepository(Customer);
      const jobsRepo = manager.getRepository(Job);
      const customer = await customerRepo.findOne({
        where: { id: customerId },
      });

      if (!customer) {
        throw new NotFoundException('Customer not found');
      }

      const jobStatus = dto.jobStatus ?? JobPipelineStage.LEAD;
      const depositPaid = dto.depositPaid ?? false;
      const normalizedDepositAmount = depositPaid
        ? (dto.depositAmount ?? 0)
        : 0;
      const projectPrice = dto.projectPrice ?? 0;
      const job = jobsRepo.create({
        customerId,
        systemType: dto.systemType,
        jobStatus,
        systemSizeKw: this.normalizeSystemSize(
          dto.systemType,
          dto.systemSizeKw,
        ),
        batterySizeKwh: this.normalizeBatterySize(
          dto.systemType,
          dto.batterySizeKwh,
        ),
        projectPrice: projectPrice.toFixed(2),
        contractSigned: dto.contractSigned ?? false,
        depositAmount: normalizedDepositAmount.toFixed(2),
        depositPaid,
        depositDate: depositPaid ? new Date().toISOString().slice(0, 10) : null,
        installDate: dto.installDate ?? null,
      });

      const savedJob = await jobsRepo.save(job);

      await this.jobAuditLogs.logWithManager(manager, {
        jobId: savedJob.id,
        performedById,
        action: JobAuditAction.JOB_CREATED,
        newValue: {
          customerId,
          systemType: savedJob.systemType,
          jobStatus: savedJob.jobStatus,
          systemSizeKw: savedJob.systemSizeKw,
          batterySizeKwh: savedJob.batterySizeKwh,
          projectPrice: savedJob.projectPrice,
        },
        metadata: {
          source: 'job_create_form',
        },
      });

      return this.findOneOrFail(jobsRepo, savedJob.id);
    });
  }

  async transitionStage(
    performedById: string | null,
    performedByRole: UserRole | null,
    id: string,
    toStage: JobPipelineStage,
    overridePreMeterLock = false,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const jobsRepo = manager.getRepository(Job);
      const job = await this.findOneOrFail(jobsRepo, id);

      if (job.jobStatus === toStage) {
        return job;
      }

      if (
        toStage === JobPipelineStage.INSTALLED &&
        !this.hasPreMeterApprovalForInstall(job.jobStatus)
      ) {
        if (!overridePreMeterLock) {
          throw new PreconditionFailedException(
            'Pre-meter is not approved. An admin must manually override the pre-meter lock before moving this job to Installed.',
          );
        }

        if (performedByRole !== UserRole.ADMIN) {
          throw new ForbiddenException(
            'Only admins can override the pre-meter lock.',
          );
        }
      }

      const previousStage = job.jobStatus;
      job.jobStatus = toStage;
      await jobsRepo.save(job);

      await this.jobAuditLogs.logWithManager(manager, {
        jobId: job.id,
        performedById,
        action: JobAuditAction.JOB_STATUS_CHANGED,
        field: 'jobStatus',
        oldValue: previousStage,
        newValue: toStage,
        metadata: {
          source: 'pipeline_drag_drop',
          overridePreMeterLock:
            toStage === JobPipelineStage.INSTALLED && overridePreMeterLock,
        },
      });

      return this.findOneOrFail(jobsRepo, id);
    });
  }

  private normalizeSystemSize(
    systemType: JobSystemType,
    systemSizeKw: number | undefined,
  ): string | null {
    if (
      systemType !== JobSystemType.SOLAR &&
      systemType !== JobSystemType.BOTH
    ) {
      return null;
    }

    return typeof systemSizeKw === 'number' ? systemSizeKw.toFixed(2) : null;
  }

  private normalizeBatterySize(
    systemType: JobSystemType,
    batterySizeKwh: number | undefined,
  ): string | null {
    if (
      systemType !== JobSystemType.BATTERY &&
      systemType !== JobSystemType.BOTH
    ) {
      return null;
    }

    return typeof batterySizeKwh === 'number'
      ? batterySizeKwh.toFixed(2)
      : null;
  }

  private hasPreMeterApprovalForInstall(stage: JobPipelineStage): boolean {
    const stageOrder: JobPipelineStage[] = [
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

    return (
      stageOrder.indexOf(stage) >=
      stageOrder.indexOf(JobPipelineStage.PRE_METER_APPROVED)
    );
  }

  private mapJobDetail(
    job: Job,
    timeline: JobAuditLog[],
  ): JobDetailResponseDto {
    return {
      job: {
        id: job.id,
        customerId: job.customerId,
        systemType: job.systemType,
        jobStatus: job.jobStatus,
        systemSizeKw: job.systemSizeKw,
        batterySizeKwh: job.batterySizeKwh,
        projectPrice: job.projectPrice,
        contractSigned: job.contractSigned,
        depositAmount: job.depositAmount,
        depositPaid: job.depositPaid,
        depositDate: job.depositDate,
        installDate: job.installDate,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
      customer: job.customer
        ? {
            id: job.customer.id,
            firstName: job.customer.firstName,
            lastName: job.customer.lastName,
            email: job.customer.email,
            phone: job.customer.phone,
            address: job.customer.address,
          }
        : null,
      timeline: timeline.map((entry) => ({
        id: entry.id,
        action: entry.action,
        field: entry.field,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
        performedBy: entry.performedBy
          ? {
              id: entry.performedBy.id,
              firstName: entry.performedBy.firstName,
              lastName: entry.performedBy.lastName,
              role: entry.performedBy.role,
            }
          : null,
        description: this.describeAuditEntry(entry),
      })),
    };
  }

  private describeAuditEntry(entry: JobAuditLog): string {
    switch (entry.action) {
      case JobAuditAction.JOB_CREATED:
        return 'Job created';
      case JobAuditAction.JOB_STATUS_CHANGED:
        return `Stage changed from ${this.humanizeValue(entry.oldValue)} to ${this.humanizeValue(entry.newValue)}${this.wasPreMeterLockOverridden(entry) ? ' with pre-meter lock override' : ''}`;
      case JobAuditAction.MANAGER_ASSIGNMENT_CHANGED:
        return 'Manager assignment updated';
      case JobAuditAction.INSTALLER_ASSIGNED:
        return 'Installer assigned';
      case JobAuditAction.INSTALLER_REMOVED:
        return 'Installer removed';
      case JobAuditAction.CONTRACT_SIGNED_CHANGED:
        return 'Contract signed status updated';
      case JobAuditAction.DEPOSIT_PAID_CHANGED:
        return 'Deposit paid status updated';
      case JobAuditAction.INSTALL_DATE_CHANGED:
        return 'Install date updated';
      case JobAuditAction.PRE_METER_STATUS_CHANGED:
        return 'Pre-meter status updated';
      case JobAuditAction.POST_METER_STATUS_CHANGED:
        return 'Post-meter status updated';
      default:
        return this.humanizeToken(entry.action);
    }
  }

  private humanizeValue(value: unknown): string {
    if (typeof value === 'string' && value.trim()) {
      return this.humanizeToken(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (!value) {
      return 'unknown';
    }

    return 'updated value';
  }

  private humanizeToken(value: string): string {
    return value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  private wasPreMeterLockOverridden(entry: JobAuditLog): boolean {
    if (!entry.metadata || typeof entry.metadata !== 'object') {
      return false;
    }

    const metadata = entry.metadata as { overridePreMeterLock?: unknown };
    return metadata.overridePreMeterLock === true;
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

      const actualFromStage = currentJob.pipelineStage as JobPipelineStage;
      const actualToStage = toStage as JobPipelineStage;
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

    let assignedStaffUserId: string | null = null;
    if (dto.assignedStaffUserId) {
      const assignee = await this.usersRepo.findOne({
        where: { id: dto.assignedStaffUserId },
      });
      if (!assignee) {
        throw new BadRequestException('Assigned staff user not found');
      }
      assignedStaffUserId = assignee.id;
    }

    return this.dataSource.transaction(async (manager) => {
      const jobRepo = manager.getRepository(Job);
      const meterRepo = manager.getRepository(MeterApplication);
      const timelineRepository = manager.getRepository(TimelineEvent);
      const noteRepo = manager.getRepository(Note);

      const maxInStage = await jobRepo.findOne({
        where: { pipelineStage: dto.pipelineStage },
        order: { pipelinePosition: 'DESC' },
      });

      const nextPipelinePosition =
        dto.pipelinePosition ?? (maxInStage?.pipelinePosition ?? 0) + 1;

      const job = jobRepo.create({
        customerId,
        systemType: dto.systemType as JobSystemType,
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
        pipelineStage: dto.pipelineStage as JobPipelineStage,
        pipelinePosition: nextPipelinePosition,
        installDate: dto.installDate ?? null,
        jobStatus: dto.pipelineStage as JobPipelineStage,
        invoiceStatus: 'not_invoiced',
        invoiceDate: null,
        invoiceDueDate: null,
        paidDate: null,
        assignedTeamId: null,
        assignedStaffUserId,
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

      const notesBody = dto.notes?.trim();
      if (notesBody) {
        await noteRepo.save(
          noteRepo.create({
            jobId: savedJob.id,
            body: notesBody,
            createdByUserId: userId,
          }),
        );
      }

      await timelineRepository.save(
        timelineRepository.create({
          jobId: savedJob.id,
          type: 'job_created',
          payload: {
            pipelineStage: savedJob.pipelineStage,
            pipelinePosition: savedJob.pipelinePosition,
            source: 'staff_job_create',
          },
          createdByUserId: userId,
        }),
      );

      return savedJob;
    });
  }
}
