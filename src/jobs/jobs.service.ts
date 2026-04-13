import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  In,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { buildEquipmentCatalogName } from '../equipment-catalog/build-equipment-catalog-name';
import { Battery } from '../batteries/entities/battery.entity';
import { Inverter } from '../inverters/entities/inverter.entity';
import { JobAuditLogsService } from './job-audit-logs.service';
import { JobAuditAction } from './job-audit-action.enum';
import { CreateJobForCustomerDto } from './dto/create-job-for-customer.dto';
import { JobDetailResponseDto } from './dto/job-detail-response.dto';
import { CreateJobTextEntryDto } from './dto/create-job-text-entry.dto';
import { JobProposalConfigResponseDto } from './dto/job-proposal-config-response.dto';
import {
  UpdateJobProposalConfigDto,
  UpdateJobProposalConfigItemDto,
} from './dto/update-job-proposal-config.dto';
import { JobProposalEquipmentType } from './job-proposal-equipment-type.enum';
import { JobPipelineStage } from './job-pipeline-stage.enum';
import { FORWARD_GATE_RULES, isBackwardsMove } from './pipeline-gate.rules';
import { JobSystemType } from './job-system-type.enum';
import { JobAuditLog } from './entities/job-audit-log.entity';
import { JobInternalComment } from './entities/job-internal-comment.entity';
import { JobProposalSelection } from './entities/job-proposal-selection.entity';
import { Job } from './entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity';
import { FindJobsQueryDto } from './dto/find-jobs-query.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceStatus } from '../invoices/entities/invoice-status.enum';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { Note } from '../notes/entities/note.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { UpdateJobPipelineDto } from './dto/update-job-pipeline.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { SolarPanel } from '../solar-panels/entities/solar-panel.entity';
import { JobAuditValue } from './types/job-audit-value.type';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';

export type JobListViewer = { userId: string; role: UserRole };

type ProposalSummarySyncInput = {
  equipmentType: JobProposalEquipmentType;
  quantity: number;
  proposalUnitPrice: number;
  wattage: number | null;
  batteryCapacityKwh: number | null;
};

@Injectable()
export class JobsService {
  private static readonly ORDER_NUMBER_PREFIX = 'ORD-';
  private static readonly FIRST_ORDER_NUMBER = 1001;
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    private readonly dataSource: DataSource,
    private readonly jobAuditLogs: JobAuditLogsService,
    @InjectRepository(MeterApplication)
    private readonly meterApplicationsRepo: Repository<MeterApplication>,
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    @InjectRepository(JobProposalSelection)
    private readonly jobProposalSelectionsRepo: Repository<JobProposalSelection>,
    @InjectRepository(Customer)
    private readonly customersRepo: Repository<Customer>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Note)
    private readonly notesRepo: Repository<Note>,
    @InjectRepository(JobInternalComment)
    private readonly jobInternalCommentsRepo: Repository<JobInternalComment>,
    @InjectRepository(SolarPanel)
    private readonly solarPanelsRepo: Repository<SolarPanel>,
    @InjectRepository(Inverter)
    private readonly invertersRepo: Repository<Inverter>,
    @InjectRepository(Battery)
    private readonly batteriesRepo: Repository<Battery>,
    private readonly notificationsService: NotificationsService,
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
      const directAssignmentSubquery = qb
        .subQuery()
        .select('1')
        .from(Assignment, 'assignment')
        .where('assignment.jobId = job.id')
        .andWhere('assignment.staffUserId = :installerUserId')
        .getQuery();
      qb.andWhere(
        new Brackets((sub) => {
          sub.where('job.assignedStaffUserId = :installerUserId', {
            installerUserId: viewer.userId,
          });
          sub.orWhere(`EXISTS ${directAssignmentSubquery}`, {
            installerUserId: viewer.userId,
          });
        }),
      );
    }

    if (viewer?.role === UserRole.MANAGER) {
      qb.andWhere('job.managerId = :managerUserId', {
        managerUserId: viewer.userId,
      });
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
    const jobIds = items.map((item) => item.id);
    const invoicesByJobId = new Map<string, Invoice[]>();

    if (jobIds.length > 0) {
      const invoices = await this.dataSource.getRepository(Invoice).find({
        where: {
          jobId: In(jobIds),
        },
        relations: {
          payments: true,
        },
        order: {
          issueDate: 'DESC',
        },
      });

      invoices.forEach((invoice) => {
        if (!invoice.jobId) {
          return;
        }

        const existing = invoicesByJobId.get(invoice.jobId);
        if (existing) {
          existing.push(invoice);
          return;
        }

        invoicesByJobId.set(invoice.jobId, [invoice]);
      });
    }

    return {
      items: items.map((item) => ({
        ...item,
        ...this.buildDerivedInvoiceFields(
          item,
          invoicesByJobId.get(item.id) ?? [],
        ),
      })),
      total,
      page,
      pageSize,
    };
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

    if (viewer?.role === UserRole.MANAGER) {
      this.assertManagerJobAccess(job, viewer.userId);
    }

    return job;
  }

  async getOne(id: string, viewer?: JobListViewer) {
    const job = await this.findOneOrFail(this.jobsRepo, id, viewer);
    return this.buildJobDetailResponse(job);
  }

  async updateJob(
    id: string,
    dto: UpdateJobDto,
    viewer: JobListViewer,
  ): Promise<JobDetailResponseDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one job field is required');
    }

    let managerAssignmentNotificationManagerId: string | null = null;
    let managerAssignmentNotificationJobId: string | null = null;
    let managerAssignmentNotificationOrderNumber: string | null = null;
    let managerAssignmentNotificationCustomerName: string | null = null;
    let managerAssignmentNotificationAssignedByUserId: string | null = null;

    await this.dataSource.transaction(async (manager) => {
      const jobsRepo = manager.getRepository(Job);
      const usersRepo = manager.getRepository(User);
      const timelineRepository = manager.getRepository(TimelineEvent);
      const job = await this.findOneOrFail(jobsRepo, id, viewer);

      const hasManagerIdUpdate = Object.hasOwn(dto, 'managerId');
      const hasSystemSizeUpdate = Object.hasOwn(dto, 'systemSizeKw');
      const hasBatterySizeUpdate = Object.hasOwn(dto, 'batterySizeKwh');

      const nextManagerId =
        dto.managerId === undefined ? job.managerId : dto.managerId;
      const nextSystemType = (dto.systemType ??
        job.systemType) as JobSystemType;
      const nextSystemSizeKw = this.normalizeSystemSize(
        nextSystemType,
        hasSystemSizeUpdate
          ? (dto.systemSizeKw ?? undefined)
          : job.systemSizeKw !== null
            ? Number(job.systemSizeKw)
            : undefined,
      );
      const nextBatterySizeKwh = this.normalizeBatterySize(
        nextSystemType,
        hasBatterySizeUpdate
          ? (dto.batterySizeKwh ?? undefined)
          : job.batterySizeKwh !== null
            ? Number(job.batterySizeKwh)
            : undefined,
      );
      const nextProjectPrice =
        dto.projectPrice !== undefined
          ? dto.projectPrice.toFixed(2)
          : (job.projectPrice ?? '0.00');
      const nextContractSigned = dto.contractSigned ?? job.contractSigned;
      const nextDepositPaid = dto.depositPaid ?? job.depositPaid;
      const nextDepositAmount =
        dto.depositAmount !== undefined
          ? dto.depositAmount.toFixed(2)
          : job.depositAmount;
      const nextInstallDate =
        dto.installDate === undefined ? job.installDate : dto.installDate;
      const nextEtaCompletionDate =
        dto.etaCompletionDate === undefined
          ? job.etaCompletionDate
          : dto.etaCompletionDate;
      const nextDepositDate = nextDepositPaid
        ? (job.depositDate ?? new Date().toISOString().slice(0, 10))
        : null;

      if (
        viewer.role !== UserRole.ADMIN &&
        hasManagerIdUpdate &&
        nextManagerId !== job.managerId
      ) {
        throw new ForbiddenException(
          'Only admins can update manager assignment',
        );
      }

      let validatedManagerId: string | null = null;
      if (nextManagerId) {
        const managerUser = await usersRepo.findOne({
          where: { id: nextManagerId },
        });
        if (!managerUser) {
          throw new NotFoundException('Manager user not found');
        }
        if (managerUser.role !== UserRole.MANAGER) {
          throw new BadRequestException('Selected user is not a manager');
        }
        validatedManagerId = managerUser.id;
      }

      const changedSummaryFields: string[] = [];

      const markChanged = (
        field: string,
        oldValue: string | number | boolean | null | undefined,
        newValue: string | number | boolean | null | undefined,
      ) => {
        const normalize = (v: string | number | boolean | null | undefined) => {
          if (v === null || v === undefined) return null;
          const n = Number(v);
          return Number.isFinite(n) ? n.toString() : String(v);
        };
        if (normalize(oldValue) !== normalize(newValue)) {
          changedSummaryFields.push(field);
        }
      };

      markChanged('systemType', job.systemType, nextSystemType);
      markChanged('systemSizeKw', job.systemSizeKw, nextSystemSizeKw);
      markChanged('batterySizeKwh', job.batterySizeKwh, nextBatterySizeKwh);
      markChanged('projectPrice', job.projectPrice, nextProjectPrice);
      markChanged('contractSigned', job.contractSigned, nextContractSigned);
      markChanged('depositPaid', job.depositPaid, nextDepositPaid);
      markChanged('depositAmount', job.depositAmount, nextDepositAmount);
      markChanged('installDate', job.installDate, nextInstallDate);
      markChanged(
        'etaCompletionDate',
        job.etaCompletionDate,
        nextEtaCompletionDate,
      );
      markChanged('managerId', job.managerId, validatedManagerId);

      if (changedSummaryFields.length === 0) {
        return;
      }

      const previousManagerId = job.managerId;
      const previousContractSigned = job.contractSigned;
      const previousDepositPaid = job.depositPaid;
      const previousInstallDate = job.installDate;

      job.systemType = nextSystemType;
      job.systemSizeKw = nextSystemSizeKw;
      job.batterySizeKwh = nextBatterySizeKwh;
      job.projectPrice = nextProjectPrice;
      job.contractSigned = nextContractSigned;
      job.depositPaid = nextDepositPaid;
      job.depositAmount = nextDepositAmount;
      job.depositDate = nextDepositDate;
      job.installDate = nextInstallDate;
      job.etaCompletionDate = nextEtaCompletionDate;
      job.managerId = validatedManagerId;

      await jobsRepo.save(job);

      if (previousManagerId !== validatedManagerId) {
        await this.jobAuditLogs.logWithManager(manager, {
          jobId: job.id,
          performedById: viewer.userId,
          action: JobAuditAction.MANAGER_ASSIGNMENT_CHANGED,
          field: 'managerId',
          oldValue: previousManagerId,
          newValue: validatedManagerId,
          metadata: {
            source: 'job_detail_summary',
          },
        });
      }

      if (previousContractSigned !== nextContractSigned) {
        await this.jobAuditLogs.logWithManager(manager, {
          jobId: job.id,
          performedById: viewer.userId,
          action: JobAuditAction.CONTRACT_SIGNED_CHANGED,
          field: 'contractSigned',
          oldValue: previousContractSigned,
          newValue: nextContractSigned,
          metadata: {
            source: 'job_detail_summary',
          },
        });
      }

      if (previousDepositPaid !== nextDepositPaid) {
        await this.jobAuditLogs.logWithManager(manager, {
          jobId: job.id,
          performedById: viewer.userId,
          action: JobAuditAction.DEPOSIT_PAID_CHANGED,
          field: 'depositPaid',
          oldValue: previousDepositPaid,
          newValue: nextDepositPaid,
          metadata: {
            source: 'job_detail_summary',
          },
        });
      }

      if (previousInstallDate !== nextInstallDate) {
        await this.jobAuditLogs.logWithManager(manager, {
          jobId: job.id,
          performedById: viewer.userId,
          action: JobAuditAction.INSTALL_DATE_CHANGED,
          field: 'installDate',
          oldValue: previousInstallDate,
          newValue: nextInstallDate,
          metadata: {
            source: 'job_detail_summary',
          },
        });
      }

      const genericChangedFields = changedSummaryFields.filter(
        (field) =>
          ![
            'managerId',
            'contractSigned',
            'depositPaid',
            'installDate',
          ].includes(field),
      );

      if (genericChangedFields.length > 0) {
        await timelineRepository.save(
          timelineRepository.create({
            jobId: job.id,
            type: 'job_summary_updated',
            payload: {
              fields: genericChangedFields,
            },
            createdByUserId: viewer.userId,
          }),
        );
      }

      if (previousManagerId !== validatedManagerId && validatedManagerId) {
        managerAssignmentNotificationManagerId = validatedManagerId;
        managerAssignmentNotificationJobId = job.id;
        managerAssignmentNotificationOrderNumber = job.orderNumber;
        managerAssignmentNotificationCustomerName = job.customer
          ? `${job.customer.firstName} ${job.customer.lastName}`.trim()
          : null;
        managerAssignmentNotificationAssignedByUserId = viewer.userId;
      }
    });

    if (
      managerAssignmentNotificationManagerId &&
      managerAssignmentNotificationJobId &&
      managerAssignmentNotificationOrderNumber &&
      managerAssignmentNotificationAssignedByUserId
    ) {
      const assignedManagerId = String(managerAssignmentNotificationManagerId);
      const assignedJobId = String(managerAssignmentNotificationJobId);
      const assignedOrderNumber = String(
        managerAssignmentNotificationOrderNumber,
      );

      try {
        await this.notificationsService.sendToUser(assignedManagerId, {
          type: NOTIFICATION_TYPE.JOB_ASSIGNED_TO_MANAGER,
          title: 'New manager assignment',
          body: `You were assigned to job ${assignedOrderNumber}.`,
          metadata: {
            jobId: assignedJobId,
            orderNumber: assignedOrderNumber,
            customerName: managerAssignmentNotificationCustomerName,
            assignedByUserId: managerAssignmentNotificationAssignedByUserId,
            managerId: assignedManagerId,
          },
          dedupeKey: `manager-assignment:${assignedJobId}:${assignedManagerId}`,
        });
      } catch (error) {
        this.logger.warn(
          `Manager assignment notification failed for job ${assignedJobId} and manager ${assignedManagerId}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    return this.getOne(id, viewer);
  }

  async createNote(
    id: string,
    dto: CreateJobTextEntryDto,
    viewer: JobListViewer,
  ) {
    await this.findOneOrFail(this.jobsRepo, id, viewer);

    const savedNote = await this.notesRepo.save(
      this.notesRepo.create({
        jobId: id,
        body: dto.body.trim(),
        createdByUserId: viewer.userId,
      }),
    );

    const createdNote = await this.notesRepo.findOne({
      where: { id: savedNote.id },
      relations: {
        createdByUser: true,
      },
    });

    if (!createdNote) {
      throw new NotFoundException('Job note not found after save');
    }

    return this.mapTextEntry(createdNote);
  }

  async createInternalComment(
    id: string,
    dto: CreateJobTextEntryDto,
    viewer: JobListViewer,
  ) {
    await this.findOneOrFail(this.jobsRepo, id, viewer);

    const savedComment = await this.jobInternalCommentsRepo.save(
      this.jobInternalCommentsRepo.create({
        jobId: id,
        body: dto.body.trim(),
        createdByUserId: viewer.userId,
      }),
    );

    const createdComment = await this.jobInternalCommentsRepo.findOne({
      where: { id: savedComment.id },
      relations: {
        createdByUser: true,
      },
    });

    if (!createdComment) {
      throw new NotFoundException('Job internal comment not found after save');
    }

    return this.mapTextEntry(createdComment);
  }

  async getProposalConfig(
    id: string,
    viewer?: JobListViewer,
  ): Promise<JobProposalConfigResponseDto> {
    await this.findOneOrFail(this.jobsRepo, id, viewer);

    const selections = await this.jobProposalSelectionsRepo.find({
      where: { jobId: id },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    return this.buildProposalConfigResponse(id, selections);
  }

  async updateProposalConfig(
    jobId: string,
    dto: UpdateJobProposalConfigDto,
    viewer: JobListViewer,
  ): Promise<JobProposalConfigResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const jobsRepo = manager.getRepository(Job);
      const proposalSelectionsRepo =
        manager.getRepository(JobProposalSelection);
      const timelineRepository = manager.getRepository(TimelineEvent);
      const job = await this.findOneOrFail(jobsRepo, jobId, viewer);
      const normalizedItems = await this.normalizeProposalItems(dto.items);

      await proposalSelectionsRepo.delete({ jobId });

      const savedSelections =
        normalizedItems.length === 0
          ? []
          : await proposalSelectionsRepo.save(
              normalizedItems.map((item, index) =>
                proposalSelectionsRepo.create({
                  jobId,
                  equipmentType: item.equipmentType,
                  equipmentId: item.equipmentId,
                  equipmentNameSnapshot: item.name,
                  equipmentSubtitleSnapshot: item.subtitle,
                  defaultUnitPriceSnapshot: item.defaultUnitPrice.toFixed(2),
                  proposalUnitPrice: item.proposalUnitPrice.toFixed(2),
                  quantity: item.quantity,
                  sortOrder: index,
                }),
              ),
            );

      const syncedSummary = this.deriveJobSummaryFromProposalItems(
        normalizedItems,
        job.systemType,
      );
      const nextSystemType = syncedSummary.systemType;
      const nextSystemSizeKw = this.normalizeSystemSize(
        nextSystemType,
        syncedSummary.systemSizeKw,
      );
      const nextBatterySizeKwh = this.normalizeBatterySize(
        nextSystemType,
        syncedSummary.batterySizeKwh,
      );
      const nextProjectPrice = syncedSummary.projectPrice.toFixed(2);

      const changedSummaryFields: string[] = [];

      const markChanged = (
        field: string,
        oldValue: string | number | boolean | null | undefined,
        newValue: string | number | boolean | null | undefined,
      ) => {
        const normalize = (v: string | number | boolean | null | undefined) => {
          if (v === null || v === undefined) return null;
          const n = Number(v);
          return Number.isFinite(n) ? n.toString() : String(v);
        };
        if (normalize(oldValue) !== normalize(newValue)) {
          changedSummaryFields.push(field);
        }
      };

      markChanged('systemType', job.systemType, nextSystemType);
      markChanged('systemSizeKw', job.systemSizeKw, nextSystemSizeKw);
      markChanged('batterySizeKwh', job.batterySizeKwh, nextBatterySizeKwh);
      markChanged('projectPrice', job.projectPrice, nextProjectPrice);

      if (changedSummaryFields.length > 0) {
        job.systemType = nextSystemType;
        job.systemSizeKw = nextSystemSizeKw;
        job.batterySizeKwh = nextBatterySizeKwh;
        job.projectPrice = nextProjectPrice;

        await jobsRepo.save(job);
        await timelineRepository.save(
          timelineRepository.create({
            jobId,
            type: 'job_summary_updated',
            payload: {
              fields: changedSummaryFields,
              source: 'proposal_config',
            },
            createdByUserId: viewer.userId,
          }),
        );
      }

      return this.buildProposalConfigResponse(jobId, savedSelections);
    });
  }

  async createForCustomer(
    performedById: string | null,
    performedByRole: UserRole | null,
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
      const savedJob = await this.createJobWithGeneratedOrderNumber(jobsRepo, {
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
        managerId: performedByRole === UserRole.MANAGER ? performedById : null,
      });

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
      const viewer =
        performedById && performedByRole
          ? { userId: performedById, role: performedByRole }
          : undefined;
      const job = await this.findOneOrFail(jobsRepo, id, viewer);

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

      return this.findOneOrFail(jobsRepo, id, viewer);
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

  private deriveJobSummaryFromProposalItems(
    items: ProposalSummarySyncInput[],
    fallbackSystemType: JobSystemType,
  ) {
    const totalSolarWattage = items.reduce((sum, item) => {
      if (
        item.equipmentType !== JobProposalEquipmentType.PANEL ||
        item.wattage === null
      ) {
        return sum;
      }

      return sum + item.wattage * item.quantity;
    }, 0);
    const totalBatteryCapacityKwh = items.reduce((sum, item) => {
      if (
        item.equipmentType !== JobProposalEquipmentType.BATTERY ||
        item.batteryCapacityKwh === null
      ) {
        return sum;
      }

      return sum + item.batteryCapacityKwh * item.quantity;
    }, 0);
    const projectPrice = items.reduce(
      (sum, item) => sum + item.proposalUnitPrice * item.quantity,
      0,
    );

    const hasSolar = totalSolarWattage > 0;
    const hasBattery = totalBatteryCapacityKwh > 0;

    let systemType = fallbackSystemType;
    if (hasSolar && hasBattery) {
      systemType = JobSystemType.BOTH;
    } else if (hasSolar) {
      systemType = JobSystemType.SOLAR;
    } else if (hasBattery) {
      systemType = JobSystemType.BATTERY;
    }

    return {
      systemType,
      systemSizeKw: hasSolar ? totalSolarWattage / 1000 : undefined,
      batterySizeKwh: hasBattery ? totalBatteryCapacityKwh : undefined,
      projectPrice,
    };
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

  private async buildJobDetailResponse(
    job: Job,
  ): Promise<JobDetailResponseDto> {
    const [
      auditTimeline,
      timelineEvents,
      manager,
      assignedStaffUser,
      installerRows,
      invoices,
      notes,
      internalComments,
    ] = await Promise.all([
      this.dataSource.getRepository(JobAuditLog).find({
        where: { jobId: job.id },
        relations: {
          performedBy: true,
        },
        order: {
          createdAt: 'DESC',
        },
      }),
      this.dataSource.getRepository(TimelineEvent).find({
        where: { jobId: job.id },
        relations: {
          createdByUser: true,
        },
        order: {
          createdAt: 'DESC',
        },
      }),
      job.managerId
        ? this.usersRepo.findOne({ where: { id: job.managerId } })
        : Promise.resolve(null),
      job.assignedStaffUserId
        ? this.usersRepo.findOne({ where: { id: job.assignedStaffUserId } })
        : Promise.resolve(null),
      this.assignmentsRepo.find({
        where: { jobId: job.id },
        relations: {
          staffUser: true,
        },
        order: {
          scheduledDate: 'ASC',
          slot: 'ASC',
        },
      }),
      this.dataSource.getRepository(Invoice).find({
        where: { jobId: job.id },
        relations: {
          payments: true,
        },
        order: {
          issueDate: 'DESC',
        },
      }),
      this.notesRepo.find({
        where: { jobId: job.id },
        relations: {
          createdByUser: true,
        },
        order: {
          createdAt: 'ASC',
        },
      }),
      this.jobInternalCommentsRepo.find({
        where: { jobId: job.id },
        relations: {
          createdByUser: true,
        },
        order: {
          createdAt: 'ASC',
        },
      }),
    ]);

    const projectPrice = Number(job.projectPrice ?? 0);
    const hasProjectPrice = Number.isFinite(projectPrice) && projectPrice > 0;
    const paidDepositAmount = job.depositPaid
      ? Number(job.depositAmount ?? 0)
      : 0;
    const activeInvoices = invoices.filter(
      (invoice) => invoice.status !== InvoiceStatus.CANCELLED,
    );
    const invoicePaidAmount = activeInvoices.reduce(
      (sum, invoice) => sum + Number(invoice.amountPaid ?? 0),
      0,
    );
    const totalPaidAmount = paidDepositAmount + invoicePaidAmount;
    const remainingAmountNumber = hasProjectPrice
      ? Math.max(projectPrice - totalPaidAmount, 0)
      : null;
    const derivedInvoiceFields = this.buildDerivedInvoiceFields(job, invoices);

    const mapTimelineActor = (user: User | null | undefined) => {
      if (!user) return null;
      const firstName = this.safeTrim(user.firstName);
      const lastName = this.safeTrim(user.lastName);
      return {
        id: user.id,
        firstName,
        lastName,
        role: user.role,
      };
    };

    const combinedTimeline = [
      ...auditTimeline.map((entry) => ({
        id: entry.id,
        source: 'audit' as const,
        eventType: entry.action,
        action: entry.action,
        field: entry.field,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        metadata: entry.metadata,
        payload: null,
        createdAt: entry.createdAt,
        performedBy: mapTimelineActor(entry.performedBy),
        createdByName: this.getTimelineActorName(entry.performedBy),
        description: this.describeAuditEntry(entry),
      })),
      ...timelineEvents.map((entry) => ({
        id: entry.id,
        source: 'event' as const,
        eventType: entry.type,
        action: null,
        field: null,
        oldValue: null,
        newValue: null,
        metadata: null,
        payload: this.normalizeTimelinePayload(entry.payload),
        createdAt: entry.createdAt,
        performedBy: mapTimelineActor(entry.createdByUser),
        createdByName: this.getTimelineActorName(entry.createdByUser),
        description: this.describeTimelineEvent(entry),
      })),
    ].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );

    return {
      job: {
        id: job.id,
        orderNumber: job.orderNumber,
        customerId: job.customerId,
        systemType: job.systemType,
        jobStatus: job.jobStatus,
        pipelineStage: job.pipelineStage,
        pipelinePosition: job.pipelinePosition,
        systemSizeKw: job.systemSizeKw,
        batterySizeKwh: job.batterySizeKwh,
        projectPrice: job.projectPrice,
        contractSigned: job.contractSigned,
        depositAmount: job.depositAmount,
        depositPaid: job.depositPaid,
        depositDate: job.depositDate,
        etaCompletionDate: job.etaCompletionDate,
        installDate: job.installDate,
        scheduledDate: job.scheduledDate,
        scheduledSlot: job.scheduledSlot,
        managerId: job.managerId,
        assignedStaffUserId: job.assignedStaffUserId,
        invoiceStatus: derivedInvoiceFields.invoiceStatus,
        invoiceDate: derivedInvoiceFields.invoiceDate,
        invoiceDueDate: derivedInvoiceFields.invoiceDueDate,
        paidDate: derivedInvoiceFields.paidDate,
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
      manager: this.mapUserSummary(manager),
      assignedStaffUser: this.mapUserSummary(assignedStaffUser),
      installerAssignments: installerRows.map((row) => ({
        id: row.id,
        scheduledDate: row.scheduledDate,
        slot: row.slot,
        locked: row.locked,
        lockedAt: row.lockedAt,
        lockReason: row.lockReason,
        installer: this.mapUserSummary(row.staffUser),
      })),
      financials: {
        depositPaidAmount: paidDepositAmount.toFixed(2),
        remainingAmount:
          remainingAmountNumber !== null
            ? remainingAmountNumber.toFixed(2)
            : null,
      },
      notes: notes.map((entry) => this.mapTextEntry(entry)),
      internalComments: internalComments.map((entry) =>
        this.mapTextEntry(entry),
      ),
      timeline: combinedTimeline,
    };
  }

  private safeTrim(value: string | null | undefined): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private mapUserSummary(user: User | null | undefined) {
    if (!user) return null;

    const firstName = this.safeTrim(user.firstName);
    const lastName = this.safeTrim(user.lastName);

    return {
      id: user.id,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      email: this.safeTrim(user.emailAddress),
      phone: this.safeTrim(user.phoneNumber),
      role: user.role,
    };
  }

  private mapTextEntry(entry: Note | JobInternalComment) {
    return {
      id: entry.id,
      body: entry.body,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      createdBy: this.mapTextEntryActor(entry.createdByUser),
    };
  }

  private mapTextEntryActor(user: User | null | undefined) {
    if (!user) return null;

    const firstName = this.safeTrim(user.firstName);
    const lastName = this.safeTrim(user.lastName);

    return {
      id: user.id,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
    };
  }

  private getTimelineActorName(user: User | null | undefined): string {
    const firstName = this.safeTrim(user?.firstName);
    const lastName = this.safeTrim(user?.lastName);
    const fullName = `${firstName} ${lastName}`.trim();

    return fullName || 'System';
  }

  private describeAuditEntry(entry: JobAuditLog): string {
    switch (entry.action) {
      case JobAuditAction.JOB_CREATED:
        return 'Job created';
      case JobAuditAction.JOB_SOFT_DELETED:
        return 'Job archived (soft delete)';
      case JobAuditAction.JOB_RESTORED:
        return 'Job restored';
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
        return this.humanizeToken(
          typeof entry.action === 'string'
            ? entry.action
            : String(entry.action ?? ''),
        );
    }
  }

  private describeTimelineEvent(entry: TimelineEvent): string {
    const payload = this.normalizeTimelinePayload(entry.payload);

    switch (entry.type) {
      case 'job_file_uploaded': {
        const label = this.readTimelinePayloadString(payload, 'displayName');
        const kind = this.readTimelinePayloadString(payload, 'kind');
        if (label) {
          return kind === 'compliance'
            ? `Compliance file uploaded: ${label}`
            : `File uploaded: ${label}`;
        }

        return kind === 'compliance'
          ? 'Compliance file uploaded'
          : 'File uploaded';
      }
      case 'meter_file_uploaded': {
        const label =
          this.readTimelinePayloadString(payload, 'displayName') ||
          this.readTimelinePayloadString(payload, 'originalName');
        return label ? `Meter file uploaded: ${label}` : 'Meter file uploaded';
      }
      case 'meter_status_change': {
        const status = this.readTimelinePayloadString(payload, 'status');
        return status
          ? `Meter application ${this.humanizeToken(status)}`
          : 'Meter application updated';
      }
      case 'assignment_lock_change': {
        const locked =
          payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload.locked
            : null;
        if (typeof locked === 'boolean') {
          return locked ? 'Assignment locked' : 'Assignment unlocked';
        }

        return 'Assignment lock updated';
      }
      case 'attendance_clock_in':
        return 'Staff clocked in';
      case 'attendance_clock_out':
        return 'Staff clocked out';
      case 'quotation_sent': {
        const recipient =
          this.readTimelinePayloadString(payload, 'recipientEmail') ||
          'customer';
        return `Quotation sent to ${recipient}`;
      }
      case 'job_summary_updated': {
        const source = this.readTimelinePayloadString(payload, 'source');
        const fields =
          payload &&
          typeof payload === 'object' &&
          !Array.isArray(payload) &&
          Array.isArray(payload.fields)
            ? payload.fields.filter(
                (value): value is string => typeof value === 'string',
              )
            : [];
        const prefix =
          source === 'proposal_config'
            ? 'Job summary synced from proposal configuration'
            : 'Job summary updated';
        if (fields.length === 0) {
          return prefix;
        }
        const labels = fields.map((field) => this.humanizeToken(field));
        return `${prefix}: ${labels.join(', ')}`;
      }
      default:
        return this.humanizeToken(entry.type);
    }
  }

  private normalizeTimelinePayload(payload: unknown): JobAuditValue | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    return payload as JobAuditValue;
  }

  private readTimelinePayloadString(
    payload: JobAuditValue | null,
    key: string,
  ): string {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return '';
    }

    const value = payload[key];
    return typeof value === 'string' ? value.trim() : '';
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

  private humanizeToken(value: string | null | undefined): string {
    if (value == null || typeof value !== 'string') {
      return 'Event';
    }
    const t = value.trim();
    if (!t) {
      return 'Event';
    }
    return t
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

  private async buildProposalConfigResponse(
    jobId: string,
    selections: JobProposalSelection[],
  ): Promise<JobProposalConfigResponseDto> {
    const catalogMaps = await this.loadEquipmentMaps(selections);
    const items = selections.map((selection) =>
      this.mapProposalSelection(selection, catalogMaps),
    );

    return {
      jobId,
      items,
      totalProposalAmount: items.reduce((sum, item) => sum + item.lineTotal, 0),
    };
  }

  private async normalizeProposalItems(
    items: UpdateJobProposalConfigItemDto[],
  ): Promise<
    Array<
      UpdateJobProposalConfigItemDto & {
        name: string;
        subtitle: string;
        defaultUnitPrice: number;
        wattage: number | null;
        batteryCapacityKwh: number | null;
      }
    >
  > {
    const requestedByType = {
      [JobProposalEquipmentType.PANEL]: [] as string[],
      [JobProposalEquipmentType.INVERTER]: [] as string[],
      [JobProposalEquipmentType.BATTERY]: [] as string[],
      [JobProposalEquipmentType.MISC]: [] as string[],
    };

    items.forEach((item) => {
      requestedByType[item.equipmentType].push(item.equipmentId);
    });

    const panelIds = requestedByType[JobProposalEquipmentType.PANEL];
    const inverterIds = requestedByType[JobProposalEquipmentType.INVERTER];
    const batteryIds = requestedByType[JobProposalEquipmentType.BATTERY];

    const [resolvedPanels, resolvedInverters, resolvedBatteries] =
      await Promise.all([
        panelIds.length > 0
          ? this.solarPanelsRepo
              .createQueryBuilder('panel')
              .where('panel.id IN (:...ids)', { ids: panelIds })
              .getMany()
          : Promise.resolve([] as SolarPanel[]),
        inverterIds.length > 0
          ? this.invertersRepo
              .createQueryBuilder('inverter')
              .where('inverter.id IN (:...ids)', { ids: inverterIds })
              .getMany()
          : Promise.resolve([] as Inverter[]),
        batteryIds.length > 0
          ? this.batteriesRepo
              .createQueryBuilder('battery')
              .where('battery.id IN (:...ids)', { ids: batteryIds })
              .getMany()
          : Promise.resolve([] as Battery[]),
      ]);

    const panelMap = new Map(resolvedPanels.map((panel) => [panel.id, panel]));
    const inverterMap = new Map(
      resolvedInverters.map((inverter) => [inverter.id, inverter]),
    );
    const batteryMap = new Map(
      resolvedBatteries.map((battery) => [battery.id, battery]),
    );

    return items.map((item) => {
      if (item.equipmentType === JobProposalEquipmentType.MISC) {
        const trimmedName = item.name?.trim() ?? '';
        if (!trimmedName) {
          throw new BadRequestException(
            'Miscellaneous proposal items require a name',
          );
        }

        return {
          ...item,
          name: trimmedName,
          subtitle: item.subtitle?.trim() ?? '',
          defaultUnitPrice: item.proposalUnitPrice,
          wattage: null,
          batteryCapacityKwh: null,
        };
      }

      if (item.equipmentType === JobProposalEquipmentType.PANEL) {
        const panel = panelMap.get(item.equipmentId);
        if (!panel) {
          throw new BadRequestException(
            'One or more solar panels were not found',
          );
        }

        return {
          ...item,
          name: buildEquipmentCatalogName(panel.brand, panel.model),
          subtitle: `${this.formatNumeric(panel.wattage)} W panel`,
          defaultUnitPrice: Number(panel.defaultUnitPrice),
          wattage: Number(panel.wattage),
          batteryCapacityKwh: null,
        };
      }

      if (item.equipmentType === JobProposalEquipmentType.INVERTER) {
        const inverter = inverterMap.get(item.equipmentId);
        if (!inverter) {
          throw new BadRequestException('One or more inverters were not found');
        }

        return {
          ...item,
          name: buildEquipmentCatalogName(inverter.brand, inverter.model),
          subtitle: `${this.formatNumeric(inverter.capacityKw)} kW inverter`,
          defaultUnitPrice: Number(inverter.defaultUnitPrice),
          wattage: null,
          batteryCapacityKwh: null,
        };
      }

      const battery = batteryMap.get(item.equipmentId);
      if (!battery) {
        throw new BadRequestException('One or more batteries were not found');
      }

      return {
        ...item,
        name: buildEquipmentCatalogName(battery.brand, battery.model),
        subtitle: `${this.formatNumeric(battery.capacityKwh)} kWh battery`,
        defaultUnitPrice: Number(battery.defaultUnitPrice),
        wattage: null,
        batteryCapacityKwh: Number(battery.capacityKwh),
      };
    });
  }

  private async loadEquipmentMaps(selections: JobProposalSelection[]) {
    const panelIds = selections
      .filter(
        (selection) =>
          selection.equipmentType === JobProposalEquipmentType.PANEL,
      )
      .map((selection) => selection.equipmentId);
    const inverterIds = selections
      .filter(
        (selection) =>
          selection.equipmentType === JobProposalEquipmentType.INVERTER,
      )
      .map((selection) => selection.equipmentId);
    const batteryIds = selections
      .filter(
        (selection) =>
          selection.equipmentType === JobProposalEquipmentType.BATTERY,
      )
      .map((selection) => selection.equipmentId);

    const [panels, inverters, batteries] = await Promise.all([
      panelIds.length > 0
        ? this.solarPanelsRepo
            .createQueryBuilder('panel')
            .where('panel.id IN (:...ids)', { ids: panelIds })
            .getMany()
        : Promise.resolve([] as SolarPanel[]),
      inverterIds.length > 0
        ? this.invertersRepo
            .createQueryBuilder('inverter')
            .where('inverter.id IN (:...ids)', { ids: inverterIds })
            .getMany()
        : Promise.resolve([] as Inverter[]),
      batteryIds.length > 0
        ? this.batteriesRepo
            .createQueryBuilder('battery')
            .where('battery.id IN (:...ids)', { ids: batteryIds })
            .getMany()
        : Promise.resolve([] as Battery[]),
    ]);

    return {
      panels: new Map(panels.map((panel) => [panel.id, panel])),
      inverters: new Map(inverters.map((inverter) => [inverter.id, inverter])),
      batteries: new Map(batteries.map((battery) => [battery.id, battery])),
    };
  }

  private mapProposalSelection(
    selection: JobProposalSelection,
    catalogMaps: {
      panels: Map<string, SolarPanel>;
      inverters: Map<string, Inverter>;
      batteries: Map<string, Battery>;
    },
  ) {
    const proposalUnitPrice = Number(selection.proposalUnitPrice);
    const defaultUnitPrice = Number(selection.defaultUnitPriceSnapshot);

    if (selection.equipmentType === JobProposalEquipmentType.MISC) {
      return {
        id: selection.id,
        equipmentType: selection.equipmentType,
        equipmentId: selection.equipmentId,
        name: selection.equipmentNameSnapshot,
        subtitle: selection.equipmentSubtitleSnapshot,
        quantity: selection.quantity,
        defaultUnitPrice,
        proposalUnitPrice,
        lineTotal: proposalUnitPrice * selection.quantity,
        stockStatus: null,
        wattage: null,
        inverterCapacityKw: null,
        batteryCapacityKwh: null,
        efficiency: null,
      };
    }

    if (selection.equipmentType === JobProposalEquipmentType.PANEL) {
      const panel = catalogMaps.panels.get(selection.equipmentId);
      return {
        id: selection.id,
        equipmentType: selection.equipmentType,
        equipmentId: selection.equipmentId,
        name: panel
          ? buildEquipmentCatalogName(panel.brand, panel.model)
          : selection.equipmentNameSnapshot,
        subtitle: panel
          ? `${this.formatNumeric(panel.wattage)} W panel`
          : selection.equipmentSubtitleSnapshot,
        quantity: selection.quantity,
        defaultUnitPrice,
        proposalUnitPrice,
        lineTotal: proposalUnitPrice * selection.quantity,
        stockStatus: panel?.stockStatus ?? null,
        wattage: panel ? Number(panel.wattage) : null,
        inverterCapacityKw: null,
        batteryCapacityKwh: null,
        efficiency:
          panel && panel.efficiency !== null ? Number(panel.efficiency) : null,
      };
    }

    if (selection.equipmentType === JobProposalEquipmentType.INVERTER) {
      const inverter = catalogMaps.inverters.get(selection.equipmentId);
      return {
        id: selection.id,
        equipmentType: selection.equipmentType,
        equipmentId: selection.equipmentId,
        name: inverter
          ? buildEquipmentCatalogName(inverter.brand, inverter.model)
          : selection.equipmentNameSnapshot,
        subtitle: inverter
          ? `${this.formatNumeric(inverter.capacityKw)} kW inverter`
          : selection.equipmentSubtitleSnapshot,
        quantity: selection.quantity,
        defaultUnitPrice,
        proposalUnitPrice,
        lineTotal: proposalUnitPrice * selection.quantity,
        stockStatus: inverter?.stockStatus ?? null,
        wattage: null,
        inverterCapacityKw: inverter ? Number(inverter.capacityKw) : null,
        batteryCapacityKwh: null,
        efficiency:
          inverter && inverter.efficiency !== null
            ? Number(inverter.efficiency)
            : null,
      };
    }

    const battery = catalogMaps.batteries.get(selection.equipmentId);
    return {
      id: selection.id,
      equipmentType: selection.equipmentType,
      equipmentId: selection.equipmentId,
      name: battery
        ? buildEquipmentCatalogName(battery.brand, battery.model)
        : selection.equipmentNameSnapshot,
      subtitle: battery
        ? `${this.formatNumeric(battery.capacityKwh)} kWh battery`
        : selection.equipmentSubtitleSnapshot,
      quantity: selection.quantity,
      defaultUnitPrice,
      proposalUnitPrice,
      lineTotal: proposalUnitPrice * selection.quantity,
      stockStatus: battery?.stockStatus ?? null,
      wattage: null,
      inverterCapacityKw: null,
      batteryCapacityKwh: battery ? Number(battery.capacityKwh) : null,
      efficiency: null,
    };
  }

  private formatNumeric(value: string): string {
    return Number(value).toString();
  }

  /** Direct assignment row on the job. */
  private async assertInstallerJobAccess(job: Job, userId: string) {
    if (job.assignedStaffUserId === userId) {
      return;
    }

    const hasAssignmentAccess = await this.assignmentsRepo.count({
      where: { jobId: job.id, staffUserId: userId },
    });
    if (hasAssignmentAccess > 0) {
      return;
    }
    throw new NotFoundException('Job not found');
  }

  private assertManagerJobAccess(job: Job, userId: string) {
    if (job.managerId === userId) {
      return;
    }

    throw new NotFoundException('Job not found');
  }

  private buildDerivedInvoiceFields(job: Job, invoices: Invoice[]) {
    const projectPrice = Number(job.projectPrice ?? 0);
    const hasProjectPrice = Number.isFinite(projectPrice) && projectPrice > 0;
    const paidDepositAmount = job.depositPaid
      ? Number(job.depositAmount ?? 0)
      : 0;
    const activeInvoices = invoices.filter(
      (invoice) => invoice.status !== InvoiceStatus.CANCELLED,
    );
    const invoicePaidAmount = activeInvoices.reduce(
      (sum, invoice) => sum + Number(invoice.amountPaid ?? 0),
      0,
    );
    const totalPaidAmount = paidDepositAmount + invoicePaidAmount;
    const remainingAmountNumber = hasProjectPrice
      ? Math.max(projectPrice - totalPaidAmount, 0)
      : null;
    const latestInvoice = activeInvoices[0] ?? null;
    const latestOutstandingInvoice =
      activeInvoices.find((invoice) => invoice.status !== InvoiceStatus.PAID) ??
      latestInvoice;
    const latestPaymentDate =
      activeInvoices
        .flatMap((invoice) => invoice.payments ?? [])
        .map((payment) => payment.paymentDate)
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => b.localeCompare(a))[0] ?? null;
    const derivedInvoiceStatus = (() => {
      if (activeInvoices.length === 0) {
        return job.invoiceStatus ?? 'not_invoiced';
      }
      if (remainingAmountNumber !== null && remainingAmountNumber <= 0.0001) {
        return 'paid';
      }
      return 'invoiced';
    })();

    return {
      invoiceStatus: derivedInvoiceStatus,
      invoiceDate: latestInvoice?.issueDate ?? job.invoiceDate,
      invoiceDueDate:
        latestOutstandingInvoice?.dueDate ??
        latestInvoice?.dueDate ??
        job.invoiceDueDate,
      paidDate:
        derivedInvoiceStatus === 'paid'
          ? (latestPaymentDate ?? job.paidDate)
          : job.paidDate,
    };
  }

  async updateJobPipeline(
    jobId: string,
    dto: UpdateJobPipelineDto,
    userRole: UserRole,
    userId: string,
  ): Promise<Job> {
    const job = await this.jobsRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (userRole === UserRole.MANAGER) {
      this.assertManagerJobAccess(job, userId);
    }

    const toStage = dto.pipelineStage;

    const fromStage = job.pipelineStage as JobPipelineStage;
    const targetStage = toStage as JobPipelineStage;

    // Check forward gate rules (only for forward moves).
    if (!isBackwardsMove(fromStage, targetStage) && fromStage !== targetStage) {
      const gateRule = FORWARD_GATE_RULES[targetStage];
      if (gateRule) {
        const gateError = gateRule(job);
        if (gateError) {
          throw new BadRequestException(gateError);
        }
      }
    }

    // Require a reason for backwards moves.
    if (isBackwardsMove(fromStage, targetStage)) {
      if (!dto.backstageReason || dto.backstageReason.trim().length < 5) {
        throw new BadRequestException(
          'A reason is required when moving a job to an earlier stage (minimum 5 characters).',
        );
      }
    }

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

    const updated = await this.dataSource.transaction(async (manager) => {
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
            ...(isBackwardsMove(actualFromStage, actualToStage) &&
            dto.backstageReason
              ? { backstageReason: dto.backstageReason.trim() }
              : {}),
          } as unknown,
          createdByUserId: userId,
        }),
      );

      const updated = await jobRepo.findOne({
        where: { id: jobId },
        relations: { customer: true },
      });
      if (!updated) throw new NotFoundException('Job not found');
      return updated;
    });

    // Write the regression audit log outside the transaction so that a
    // missing DB enum value (pending migration) never rolls back the move.
    if (isBackwardsMove(fromStage, targetStage) && dto.backstageReason) {
      try {
        await this.dataSource.transaction((manager) =>
          this.jobAuditLogs.logWithManager(manager, {
            jobId,
            performedById: userId,
            action: JobAuditAction.PIPELINE_REGRESSED,
            field: 'pipelineStage',
            oldValue: fromStage,
            newValue: targetStage,
            metadata: { reason: dto.backstageReason!.trim() },
          }),
        );
      } catch (auditErr) {
        this.logger.warn(
          `Pipeline regression audit log failed for job ${jobId}: ${String(auditErr)}`,
        );
      }
    }

    await this.notifyNeedsAssignmentIfApplicable(updated);
    return updated;
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

    const savedJob = await this.dataSource.transaction(async (manager) => {
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

      const savedJob = await this.createJobWithGeneratedOrderNumber(jobRepo, {
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
        assignedStaffUserId,
        scheduledDate: null,
        scheduledSlot: null,
        managerId: userRole === UserRole.MANAGER ? userId : null,
      });

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

    const createdJob = await this.jobsRepo.findOne({
      where: { id: savedJob.id },
      relations: { customer: true },
    });

    if (!createdJob) {
      throw new NotFoundException('Job not found');
    }

    await this.notifyNeedsAssignmentIfApplicable(createdJob);

    return createdJob;
  }

  private async notifyNeedsAssignmentIfApplicable(job: Job): Promise<void> {
    if (
      !['scheduled', 'pre_meter_approved'].includes(job.pipelineStage) ||
      !!job.assignedStaffUserId
    ) {
      return;
    }

    if (job.managerId) {
      await this.notificationsService.sendToUser(job.managerId, {
        type: NOTIFICATION_TYPE.JOB_NEEDS_ASSIGNMENT,
        title: 'Job needs installer assignment',
        body: `Job ${job.orderNumber} is ready to be assigned.`,
        metadata: {
          jobId: job.id,
          orderNumber: job.orderNumber,
          customerName: job.customer
            ? `${job.customer.firstName} ${job.customer.lastName}`.trim()
            : null,
          managerId: job.managerId,
        },
        dedupeKey: `needs-assignment:${job.id}:${job.managerId}`,
      });
      return;
    }

    await this.notificationsService.sendToRole(UserRole.ADMIN, {
      type: NOTIFICATION_TYPE.JOB_NEEDS_ASSIGNMENT,
      title: 'Job needs installer assignment',
      body: `Job ${job.orderNumber} is ready to be assigned.`,
      metadata: {
        jobId: job.id,
        orderNumber: job.orderNumber,
        customerName: job.customer
          ? `${job.customer.firstName} ${job.customer.lastName}`.trim()
          : null,
      },
      dedupeKey: `needs-assignment:${job.id}:admins`,
    });
  }

  private async createJobWithGeneratedOrderNumber(
    jobsRepo: Repository<Job>,
    payload: Omit<Partial<Job>, 'orderNumber'>,
  ) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const job = jobsRepo.create({
        ...payload,
        orderNumber: await this.generateOrderNumber(jobsRepo),
      });

      try {
        return await jobsRepo.save(job);
      } catch (error) {
        if (this.isDuplicateOrderNumberError(error)) {
          continue;
        }

        throw error;
      }
    }

    throw new BadRequestException('Failed to generate unique order number');
  }

  private async generateOrderNumber(jobsRepo: Repository<Job>) {
    const existingOrderNumbers = await jobsRepo
      .createQueryBuilder('job')
      .select('job.orderNumber', 'orderNumber')
      .where('job.orderNumber IS NOT NULL')
      .getRawMany<{ orderNumber: string | null }>();

    const highestOrderNumber = existingOrderNumbers.reduce((max, row) => {
      const parsed = this.parseOrderNumber(row.orderNumber);
      if (parsed === null || parsed <= max) {
        return max;
      }

      return parsed;
    }, JobsService.FIRST_ORDER_NUMBER - 1);

    return `${JobsService.ORDER_NUMBER_PREFIX}${highestOrderNumber + 1}`;
  }

  private parseOrderNumber(value: string | null | undefined) {
    if (!value) {
      return null;
    }

    const match = new RegExp(`^${JobsService.ORDER_NUMBER_PREFIX}(\\d+)$`).exec(
      value,
    );
    if (!match) {
      return null;
    }

    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private isDuplicateOrderNumberError(error: unknown) {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = (
      error as QueryFailedError & {
        driverError?: { code?: string; message?: string };
      }
    ).driverError;

    const message = String(driverError?.message ?? '');
    return (
      (driverError?.code === '23505' || driverError?.code === 'ER_DUP_ENTRY') &&
      message.toLowerCase().includes('ordernumber')
    );
  }
}
