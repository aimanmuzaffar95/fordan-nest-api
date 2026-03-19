import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { JobAuditLogsService } from './job-audit-logs.service';
import { JobAuditAction } from './job-audit-action.enum';
import { CreateJobForCustomerDto } from './dto/create-job-for-customer.dto';
import { JobDetailResponseDto } from './dto/job-detail-response.dto';
import { JobPipelineStage } from './job-pipeline-stage.enum';
import { JobSystemType } from './job-system-type.enum';
import { JobAuditLog } from './entities/job-audit-log.entity';
import { Job } from './entities/job.entity';
import { FindJobsQueryDto } from './dto/find-jobs-query.dto';

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    private readonly dataSource: DataSource,
    private readonly jobAuditLogs: JobAuditLogsService,
  ) {}

  async list(query: FindJobsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? query.limit ?? 20;

    const qb = this.jobsRepo
      .createQueryBuilder('job')
      .leftJoinAndSelect('job.customer', 'customer')
      .orderBy('job.createdAt', 'DESC');

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

  private async findOneOrFail(jobsRepo: Repository<Job>, id: string) {
    const job = await jobsRepo.findOne({
      where: { id },
      relations: {
        customer: true,
      },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return job;
  }

  async getOne(id: string) {
    const job = await this.findOneOrFail(this.jobsRepo, id);
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
}
