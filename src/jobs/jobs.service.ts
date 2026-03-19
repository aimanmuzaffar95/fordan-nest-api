import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { User } from '../users/entities/user.entity';
import { CreateJobForCustomerDto } from './dto/create-job-for-customer.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { JobAuditLog } from './entities/job-audit-log.entity';
import { Job } from './entities/job.entity';
import { JobAuditAction } from './enums/job-audit-action.enum';
import { JobMeterStatus, JobStatus, JobSystemType } from './enums/job.enums';
import { JobAuditValue } from './types/job-audit-value.type';

type FindJobsInput = {
  page: number;
  limit: number;
  managerId?: string;
  installerId?: string;
  customerId?: string;
  contractSigned?: boolean;
  includeDeleted: boolean;
};

type PaginatedJobs = {
  items: Job[];
  page: number;
  limit: number;
  total: number;
};

type PaginatedJobAuditLogs = {
  items: JobAuditLog[];
  page: number;
  limit: number;
  total: number;
};

type JobAuditLogInput = {
  action: JobAuditAction;
  field?: string;
  oldValue?: JobAuditValue;
  newValue?: JobAuditValue;
  metadata?: Record<string, JobAuditValue>;
};

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job)
    private readonly jobsRepository: Repository<Job>,
    @InjectRepository(JobAuditLog)
    private readonly jobAuditLogsRepository: Repository<JobAuditLog>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateJobDto, performedById: string | null): Promise<Job> {
    const createdJobId = await this.dataSource.transaction(async (manager) => {
      await this.assertCustomerExists(dto.customerId, manager);
      const assignedManager = await this.assertManagerExists(
        dto.managerId,
        manager,
      );

      const installerIds = dto.installerIds ?? [];
      const installers = await this.assertInstallersExist(
        installerIds,
        manager,
      );

      const jobsRepository = manager.getRepository(Job);
      const jobAuditLogsRepository = manager.getRepository(JobAuditLog);

      const job = jobsRepository.create({
        customerId: dto.customerId,
        managerId: assignedManager.id,
        manager: assignedManager,
        installers,
        systemType: dto.systemType,
        systemSizeKw: null,
        batterySizeKwh: null,
        projectPrice: '0.00',
        contractSigned: dto.contractSigned ?? false,
        depositAmount: '0.00',
        depositPaid: dto.depositPaid ?? false,
        depositDate: null,
        installDate: dto.installDate ?? null,
        preMeterStatus: dto.preMeterStatus ?? JobMeterStatus.NOT_STARTED,
        postMeterStatus: dto.postMeterStatus ?? JobMeterStatus.NOT_STARTED,
        jobStatus: dto.jobStatus ?? JobStatus.LEAD,
        notes: dto.notes ?? null,
        internalComments: dto.internalComments ?? null,
      });

      const savedJob = await jobsRepository.save(job);

      const logEntries: JobAuditLogInput[] = [
        {
          action: JobAuditAction.JOB_CREATED,
          newValue: {
            jobId: savedJob.id,
            customerId: savedJob.customerId,
            managerId: savedJob.managerId,
          },
        },
      ];

      for (const installer of installers) {
        logEntries.push({
          action: JobAuditAction.INSTALLER_ASSIGNED,
          field: 'installerId',
          oldValue: null,
          newValue: installer.id,
        });
      }

      await this.writeAuditLogs(
        jobAuditLogsRepository,
        savedJob.id,
        performedById,
        logEntries,
      );

      return savedJob.id;
    });

    return this.findOne(createdJobId);
  }

  async createForCustomer(
    performedById: string | null,
    performedByRole: UserRole | null,
    customerId: string,
    dto: CreateJobForCustomerDto,
  ): Promise<Job> {
    const createdJobId = await this.dataSource.transaction(async (manager) => {
      const customersRepository = manager.getRepository(Customer);
      const jobsRepository = manager.getRepository(Job);
      const jobAuditLogsRepository = manager.getRepository(JobAuditLog);

      const customer = await customersRepository.findOne({
        where: { id: customerId },
      });

      if (!customer) {
        throw new NotFoundException('Customer not found');
      }

      const assignedManager = await this.resolveCreateForCustomerManager(
        performedById,
        performedByRole,
        dto,
        manager,
      );
      const depositPaid = dto.depositPaid ?? false;
      const projectPrice = (dto.projectPrice ?? 0).toFixed(2);
      const depositAmount = depositPaid
        ? (dto.depositAmount ?? 0).toFixed(2)
        : '0.00';

      const job = jobsRepository.create({
        customerId,
        customer,
        managerId: assignedManager.id,
        manager: assignedManager,
        installers: [],
        systemType: dto.systemType,
        systemSizeKw: this.normalizeSystemSize(
          dto.systemType,
          dto.systemSizeKw,
        ),
        batterySizeKwh: this.normalizeBatterySize(
          dto.systemType,
          dto.batterySizeKwh,
        ),
        projectPrice,
        contractSigned: dto.contractSigned ?? false,
        depositAmount,
        depositPaid,
        depositDate: depositPaid ? new Date().toISOString().slice(0, 10) : null,
        installDate: dto.installDate ?? null,
        preMeterStatus: JobMeterStatus.NOT_STARTED,
        postMeterStatus: JobMeterStatus.NOT_STARTED,
        jobStatus: dto.jobStatus ?? JobStatus.LEAD,
        notes: null,
        internalComments: null,
      });

      const savedJob = await jobsRepository.save(job);

      await this.writeAuditLogs(
        jobAuditLogsRepository,
        savedJob.id,
        performedById,
        [
          {
            action: JobAuditAction.JOB_CREATED,
            newValue: {
              jobId: savedJob.id,
              customerId: savedJob.customerId,
              managerId: savedJob.managerId,
              systemType: savedJob.systemType,
              jobStatus: savedJob.jobStatus,
              systemSizeKw: savedJob.systemSizeKw,
              batterySizeKwh: savedJob.batterySizeKwh,
              projectPrice: savedJob.projectPrice,
              depositAmount: savedJob.depositAmount,
            },
            metadata: {
              source: 'job_create_form',
            },
          },
        ],
      );

      return savedJob.id;
    });

    return this.findOne(createdJobId);
  }

  async findAll(input: FindJobsInput): Promise<PaginatedJobs> {
    const queryBuilder = this.jobsRepository
      .createQueryBuilder('job')
      .leftJoinAndSelect('job.customer', 'customer')
      .leftJoinAndSelect('job.manager', 'manager')
      .leftJoinAndSelect('job.installers', 'installer')
      .orderBy('job.createdAt', 'DESC')
      .distinct(true)
      .skip((input.page - 1) * input.limit)
      .take(input.limit);

    if (input.includeDeleted) {
      queryBuilder.withDeleted();
    }

    if (input.managerId) {
      queryBuilder.andWhere('job.managerId = :managerId', {
        managerId: input.managerId,
      });
    }

    if (input.installerId) {
      queryBuilder
        .innerJoin('job.installers', 'installerFilter')
        .andWhere('installerFilter.id = :installerId', {
          installerId: input.installerId,
        });
    }

    if (input.customerId) {
      queryBuilder.andWhere('job.customerId = :customerId', {
        customerId: input.customerId,
      });
    }

    if (typeof input.contractSigned === 'boolean') {
      queryBuilder.andWhere('job.contractSigned = :contractSigned', {
        contractSigned: input.contractSigned,
      });
    }

    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      items,
      page: input.page,
      limit: input.limit,
      total,
    };
  }

  async findOne(id: string, includeDeleted = false): Promise<Job> {
    const queryBuilder = this.jobsRepository
      .createQueryBuilder('job')
      .leftJoinAndSelect('job.customer', 'customer')
      .leftJoinAndSelect('job.manager', 'manager')
      .leftJoinAndSelect('job.installers', 'installer')
      .where('job.id = :id', { id });

    if (includeDeleted) {
      queryBuilder.withDeleted();
    }

    const job = await queryBuilder.getOne();

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return job;
  }

  async update(
    id: string,
    dto: UpdateJobDto,
    performedById: string | null,
  ): Promise<Job> {
    const updatedJobId = await this.dataSource.transaction(async (manager) => {
      const jobsRepository = manager.getRepository(Job);
      const jobAuditLogsRepository = manager.getRepository(JobAuditLog);

      const job = await jobsRepository.findOne({
        where: { id },
        relations: {
          customer: true,
          manager: true,
          installers: true,
        },
      });

      if (!job) {
        throw new NotFoundException('Job not found');
      }

      const auditEntries: JobAuditLogInput[] = [];

      if (dto.customerId && dto.customerId !== job.customerId) {
        await this.assertCustomerExists(dto.customerId, manager);
        job.customerId = dto.customerId;
      }

      if (dto.managerId && dto.managerId !== job.managerId) {
        const nextManager = await this.assertManagerExists(
          dto.managerId,
          manager,
        );
        auditEntries.push({
          action: JobAuditAction.MANAGER_ASSIGNMENT_CHANGED,
          field: 'managerId',
          oldValue: job.managerId,
          newValue: nextManager.id,
        });
        job.managerId = nextManager.id;
        job.manager = nextManager;
      }

      if (Object.prototype.hasOwnProperty.call(dto, 'installerIds')) {
        const nextInstallerIds = dto.installerIds ?? [];
        const nextInstallers = await this.assertInstallersExist(
          nextInstallerIds,
          manager,
        );

        const currentInstallerIdSet = new Set(job.installers.map((u) => u.id));
        const nextInstallerIdSet = new Set(nextInstallers.map((u) => u.id));

        for (const installerId of nextInstallerIdSet) {
          if (!currentInstallerIdSet.has(installerId)) {
            auditEntries.push({
              action: JobAuditAction.INSTALLER_ASSIGNED,
              field: 'installerId',
              oldValue: null,
              newValue: installerId,
            });
          }
        }

        for (const installerId of currentInstallerIdSet) {
          if (!nextInstallerIdSet.has(installerId)) {
            auditEntries.push({
              action: JobAuditAction.INSTALLER_REMOVED,
              field: 'installerId',
              oldValue: installerId,
              newValue: null,
            });
          }
        }

        job.installers = nextInstallers;
      }

      if (dto.systemType) {
        job.systemType = dto.systemType;
      }

      if (
        typeof dto.contractSigned === 'boolean' &&
        dto.contractSigned !== job.contractSigned
      ) {
        auditEntries.push({
          action: JobAuditAction.CONTRACT_SIGNED_CHANGED,
          field: 'contractSigned',
          oldValue: job.contractSigned,
          newValue: dto.contractSigned,
        });
        job.contractSigned = dto.contractSigned;
      }

      if (
        typeof dto.depositPaid === 'boolean' &&
        dto.depositPaid !== job.depositPaid
      ) {
        auditEntries.push({
          action: JobAuditAction.DEPOSIT_PAID_CHANGED,
          field: 'depositPaid',
          oldValue: job.depositPaid,
          newValue: dto.depositPaid,
        });
        job.depositPaid = dto.depositPaid;
      }

      if (
        Object.prototype.hasOwnProperty.call(dto, 'installDate') &&
        (dto.installDate ?? null) !== job.installDate
      ) {
        auditEntries.push({
          action: JobAuditAction.INSTALL_DATE_CHANGED,
          field: 'installDate',
          oldValue: job.installDate,
          newValue: dto.installDate ?? null,
        });
        job.installDate = dto.installDate ?? null;
      }

      if (dto.preMeterStatus && dto.preMeterStatus !== job.preMeterStatus) {
        auditEntries.push({
          action: JobAuditAction.PRE_METER_STATUS_CHANGED,
          field: 'preMeterStatus',
          oldValue: job.preMeterStatus,
          newValue: dto.preMeterStatus,
        });
        job.preMeterStatus = dto.preMeterStatus;
      }

      if (dto.postMeterStatus && dto.postMeterStatus !== job.postMeterStatus) {
        auditEntries.push({
          action: JobAuditAction.POST_METER_STATUS_CHANGED,
          field: 'postMeterStatus',
          oldValue: job.postMeterStatus,
          newValue: dto.postMeterStatus,
        });
        job.postMeterStatus = dto.postMeterStatus;
      }

      if (dto.jobStatus && dto.jobStatus !== job.jobStatus) {
        auditEntries.push({
          action: JobAuditAction.JOB_STATUS_CHANGED,
          field: 'jobStatus',
          oldValue: job.jobStatus,
          newValue: dto.jobStatus,
        });
        job.jobStatus = dto.jobStatus;
      }

      if (Object.prototype.hasOwnProperty.call(dto, 'notes')) {
        job.notes = dto.notes ?? null;
      }

      if (Object.prototype.hasOwnProperty.call(dto, 'internalComments')) {
        job.internalComments = dto.internalComments ?? null;
      }

      await jobsRepository.save(job);

      await this.writeAuditLogs(
        jobAuditLogsRepository,
        job.id,
        performedById,
        auditEntries,
      );

      return job.id;
    });

    return this.findOne(updatedJobId);
  }

  async transitionStage(
    performedById: string | null,
    performedByRole: UserRole | null,
    id: string,
    toStage: JobStatus,
    overridePreMeterLock = false,
  ): Promise<Job> {
    const updatedJobId = await this.dataSource.transaction(async (manager) => {
      const jobsRepository = manager.getRepository(Job);
      const jobAuditLogsRepository = manager.getRepository(JobAuditLog);

      const job = await jobsRepository.findOne({
        where: { id },
        relations: {
          customer: true,
          manager: true,
          installers: true,
        },
      });

      if (!job) {
        throw new NotFoundException('Job not found');
      }

      if (job.jobStatus === toStage) {
        return job.id;
      }

      if (
        toStage === JobStatus.INSTALLED &&
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
      await jobsRepository.save(job);

      await this.writeAuditLogs(jobAuditLogsRepository, job.id, performedById, [
        {
          action: JobAuditAction.JOB_STATUS_CHANGED,
          field: 'jobStatus',
          oldValue: previousStage,
          newValue: toStage,
          metadata: {
            source: 'pipeline_drag_drop',
            overridePreMeterLock:
              toStage === JobStatus.INSTALLED && overridePreMeterLock,
          },
        },
      ]);

      return job.id;
    });

    return this.findOne(updatedJobId);
  }

  async softDelete(
    id: string,
    performedById: string | null,
  ): Promise<{ id: string }> {
    await this.dataSource.transaction(async (manager) => {
      const jobsRepository = manager.getRepository(Job);
      const jobAuditLogsRepository = manager.getRepository(JobAuditLog);

      const job = await jobsRepository.findOne({ where: { id } });

      if (!job) {
        throw new NotFoundException('Job not found');
      }

      await jobsRepository.softDelete(id);

      await this.writeAuditLogs(jobAuditLogsRepository, id, performedById, [
        {
          action: JobAuditAction.JOB_SOFT_DELETED,
          newValue: { deleted: true },
        },
      ]);
    });

    return { id };
  }

  async restore(id: string, performedById: string | null): Promise<Job> {
    await this.dataSource.transaction(async (manager) => {
      const jobsRepository = manager.getRepository(Job);
      const jobAuditLogsRepository = manager.getRepository(JobAuditLog);

      const job = await jobsRepository.findOne({
        where: { id },
        withDeleted: true,
      });

      if (!job || !job.deletedAt) {
        throw new NotFoundException('Job not found');
      }

      await jobsRepository.restore(id);

      await this.writeAuditLogs(jobAuditLogsRepository, id, performedById, [
        {
          action: JobAuditAction.JOB_RESTORED,
          newValue: { deleted: false },
        },
      ]);
    });

    return this.findOne(id);
  }

  async findAuditLogs(
    jobId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedJobAuditLogs> {
    await this.findOne(jobId, true);

    const [items, total] = await this.jobAuditLogsRepository.findAndCount({
      where: { jobId },
      relations: { performedBy: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      page,
      limit,
      total,
    };
  }

  private async assertCustomerExists(
    customerId: string,
    manager: DataSource['manager'],
  ): Promise<void> {
    const customersRepository = manager.getRepository(Customer);
    const customer = await customersRepository.findOne({
      where: { id: customerId },
    });

    if (!customer) {
      throw new BadRequestException('Customer not found');
    }
  }

  private async assertManagerExists(
    managerId: string,
    manager: DataSource['manager'],
  ): Promise<User> {
    const usersRepository = manager.getRepository(User);
    const assignedManager = await usersRepository.findOne({
      where: { id: managerId, role: UserRole.MANAGER },
    });

    if (!assignedManager) {
      throw new BadRequestException('Manager not found');
    }

    return assignedManager;
  }

  private async assertInstallersExist(
    installerIds: string[],
    manager: DataSource['manager'],
  ): Promise<User[]> {
    if (installerIds.length === 0) {
      return [];
    }

    const uniqueInstallerIds = [...new Set(installerIds)];
    if (uniqueInstallerIds.length !== installerIds.length) {
      throw new BadRequestException('installerIds must be unique');
    }

    const usersRepository = manager.getRepository(User);
    const installers = await usersRepository.find({
      where: {
        id: In(uniqueInstallerIds),
        role: UserRole.INSTALLER,
      },
    });

    if (installers.length !== uniqueInstallerIds.length) {
      throw new BadRequestException('One or more installers were not found');
    }

    const installersById = new Map(
      installers.map((installer) => [installer.id, installer]),
    );

    return uniqueInstallerIds.map((installerId) => {
      const installer = installersById.get(installerId);
      if (!installer) {
        throw new BadRequestException('One or more installers were not found');
      }
      return installer;
    });
  }

  private async resolveCreateForCustomerManager(
    performedById: string | null,
    performedByRole: UserRole | null,
    dto: CreateJobForCustomerDto,
    manager: DataSource['manager'],
  ): Promise<User> {
    if (performedByRole === UserRole.MANAGER) {
      if (!performedById) {
        throw new BadRequestException('Authenticated manager not found');
      }

      if (dto.managerId && dto.managerId !== performedById) {
        throw new ForbiddenException(
          'Managers can only assign customer jobs to themselves.',
        );
      }

      return this.assertManagerExists(performedById, manager);
    }

    if (performedByRole === UserRole.ADMIN) {
      if (!dto.managerId) {
        throw new BadRequestException(
          'managerId is required when an admin creates a customer job.',
        );
      }

      return this.assertManagerExists(dto.managerId, manager);
    }

    throw new ForbiddenException(
      'Only admins and managers can create customer jobs.',
    );
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

  private hasPreMeterApprovalForInstall(stage: JobStatus): boolean {
    const stageOrder: JobStatus[] = [
      JobStatus.LEAD,
      JobStatus.QUOTED,
      JobStatus.WON,
      JobStatus.PRE_METER_SUBMITTED,
      JobStatus.PRE_METER_APPROVED,
      JobStatus.SCHEDULED,
      JobStatus.INSTALLED,
      JobStatus.POST_METER_SUBMITTED,
      JobStatus.COMPLETED,
      JobStatus.INVOICED,
      JobStatus.PAID,
    ];

    return (
      stageOrder.indexOf(stage) >=
      stageOrder.indexOf(JobStatus.PRE_METER_APPROVED)
    );
  }

  private async writeAuditLogs(
    jobAuditLogsRepository: Repository<JobAuditLog>,
    jobId: string,
    performedById: string | null,
    entries: JobAuditLogInput[],
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    await jobAuditLogsRepository.save(
      entries.map((entry) =>
        jobAuditLogsRepository.create({
          jobId,
          performedById,
          action: entry.action,
          field: entry.field ?? null,
          oldValue: entry.oldValue ?? null,
          newValue: entry.newValue ?? null,
          metadata: entry.metadata ?? null,
        }),
      ),
    );
  }
}
