import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceStatus } from '../invoices/entities/invoice-status.enum';
import { JobAuditAction } from '../jobs/job-audit-action.enum';
import { JobAuditLog } from '../jobs/entities/job-audit-log.entity';
import { Job } from '../jobs/entities/job.entity';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';

type DashboardSummaryResponse = {
  generatedAt: string;
  schedulingWindow: {
    weekStart: string;
    weekEndExclusive: string;
  };
  totals: {
    totalJobs: number;
    scheduledThisWeek: number;
    waitingPreMeter: number;
    waitingPostMeter: number;
    notInvoiced: number;
    unpaidInvoices: number;
  };
};

type RevenueForecastResponse = {
  generatedAt: string;
  currency: string;
  windowDays: number;
  windowStart: string;
  windowEndInclusive: string;
  jobsInWindow: number;
  jobsWithOutstandingBalance: number;
  forecastAmount: number;
};

type ManagerActivityResponse = {
  generatedAt: string;
  items: Array<{
    id: string;
    type: 'audit' | 'assignment';
    occurredAt: string;
    managerUserId: string;
    managerName: string;
    description: string;
    job: {
      id: string;
      customerName: string;
      summaryLabel: string | null;
    } | null;
  }>;
};

type InvoiceProjection = Pick<
  Invoice,
  'id' | 'jobId' | 'status' | 'total' | 'amountPaid'
>;

type MeterStatusKey = 'pre_meter' | 'post_meter';
type ManagerActivityItem = ManagerActivityResponse['items'][number];
type DashboardViewer = {
  userId: string;
  role: UserRole;
};

@Injectable()
export class AdminDashboardReportsService {
  constructor(
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    @InjectRepository(Invoice)
    private readonly invoicesRepo: Repository<Invoice>,
    @InjectRepository(MeterApplication)
    private readonly meterApplicationsRepo: Repository<MeterApplication>,
    @InjectRepository(JobAuditLog)
    private readonly jobAuditLogsRepo: Repository<JobAuditLog>,
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async getSummary(
    viewer?: DashboardViewer,
  ): Promise<DashboardSummaryResponse> {
    const now = new Date();
    const weekStart = this.startOfWeek(now);
    const weekEndExclusive = this.addDays(weekStart, 7);
    const jobsWhere =
      viewer?.role === UserRole.MANAGER
        ? { managerId: viewer.userId }
        : undefined;

    const jobs = await this.jobsRepo.find({
      where: jobsWhere,
      select: {
        id: true,
        pipelineStage: true,
        installDate: true,
      },
    });
    const jobIds = jobs.map((job) => job.id);
    const [invoices, scopedMeterApplications] = await Promise.all([
      jobIds.length > 0
        ? this.invoicesRepo.find({
            where: { jobId: In(jobIds) },
            select: {
              id: true,
              jobId: true,
              status: true,
              total: true,
              amountPaid: true,
            },
          })
        : [],
      jobIds.length > 0
        ? this.meterApplicationsRepo.find({
            where: { jobId: In(jobIds) },
            select: {
              id: true,
              jobId: true,
              type: true,
              status: true,
              updatedAt: true,
            },
          })
        : [],
    ]);

    const activeInvoiceCountByJobId =
      this.buildActiveInvoiceCountByJobId(invoices);
    const latestMeterStatusByJobId = this.buildLatestMeterStatusByJobId(
      scopedMeterApplications,
    );
    const totals = jobs.reduce(
      (acc, job) => {
        acc.totalJobs += 1;

        if (
          job.installDate &&
          job.installDate >= this.formatDateOnly(weekStart) &&
          job.installDate < this.formatDateOnly(weekEndExclusive)
        ) {
          acc.scheduledThisWeek += 1;
        }

        const preMeterStatus = latestMeterStatusByJobId.get(job.id)?.pre_meter;
        if (
          this.isWaitingPreMeterStage(job.pipelineStage) &&
          preMeterStatus !== 'approved'
        ) {
          acc.waitingPreMeter += 1;
        }

        const postMeterStatus = latestMeterStatusByJobId.get(
          job.id,
        )?.post_meter;
        if (
          this.isWaitingPostMeterStage(job.pipelineStage) &&
          postMeterStatus !== 'approved'
        ) {
          acc.waitingPostMeter += 1;
        }

        const hasActiveInvoice =
          (activeInvoiceCountByJobId.get(job.id) ?? 0) > 0;
        if (this.isNotInvoicedStage(job.pipelineStage) && !hasActiveInvoice) {
          acc.notInvoiced += 1;
        }

        return acc;
      },
      {
        totalJobs: 0,
        scheduledThisWeek: 0,
        waitingPreMeter: 0,
        waitingPostMeter: 0,
        notInvoiced: 0,
      },
    );

    return {
      generatedAt: now.toISOString(),
      schedulingWindow: {
        weekStart: this.formatDateOnly(weekStart),
        weekEndExclusive: this.formatDateOnly(weekEndExclusive),
      },
      totals: {
        ...totals,
        unpaidInvoices: this.countUnpaidInvoices(invoices),
      },
    };
  }

  async getRevenueForecast(
    daysAhead = 30,
    viewer?: DashboardViewer,
  ): Promise<RevenueForecastResponse> {
    const windowDays = Number.isFinite(daysAhead) ? Math.max(1, daysAhead) : 30;
    const now = new Date();
    const windowStart = this.formatDateOnly(now);
    const windowEndDate = this.addDays(now, windowDays);
    const windowEndInclusive = this.formatDateOnly(windowEndDate);

    const jobsWhere =
      viewer?.role === UserRole.MANAGER
        ? { managerId: viewer.userId }
        : undefined;

    const jobs = await this.jobsRepo.find({
      where: jobsWhere,
      select: {
        id: true,
        installDate: true,
        projectPrice: true,
        depositAmount: true,
        depositPaid: true,
      },
    });

    const jobsInWindow = jobs.filter((job) => {
      return Boolean(
        job.installDate &&
        job.installDate >= windowStart &&
        job.installDate <= windowEndInclusive,
      );
    });

    const jobIdsInWindow = jobsInWindow.map((job) => job.id);
    const invoices =
      jobIdsInWindow.length > 0
        ? await this.invoicesRepo.find({
            where: { jobId: In(jobIdsInWindow) },
            select: {
              id: true,
              jobId: true,
              status: true,
              total: true,
              amountPaid: true,
            },
          })
        : [];

    const paidAmountByJobId = this.buildPaidAmountByJobId(invoices);

    let jobsWithOutstandingBalance = 0;
    const forecastAmount = jobsInWindow.reduce((sum, job) => {
      const projectPrice = Number(job.projectPrice ?? 0);
      const depositPaid = job.depositPaid ? Number(job.depositAmount ?? 0) : 0;
      const invoicePayments = paidAmountByJobId.get(job.id) ?? 0;
      const outstandingBalance = Math.max(
        projectPrice - depositPaid - invoicePayments,
        0,
      );

      if (outstandingBalance > 0.0001) {
        jobsWithOutstandingBalance += 1;
      }

      return sum + outstandingBalance;
    }, 0);

    return {
      generatedAt: now.toISOString(),
      currency: 'USD',
      windowDays,
      windowStart,
      windowEndInclusive,
      jobsInWindow: jobsInWindow.length,
      jobsWithOutstandingBalance,
      forecastAmount: Number(forecastAmount.toFixed(2)),
    };
  }

  async getManagerActivity(
    limit = 15,
    viewer?: DashboardViewer,
  ): Promise<ManagerActivityResponse> {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, limit) : 15;
    const take = safeLimit * 3;
    const assignmentsWhere =
      viewer?.role === UserRole.MANAGER
        ? {
            job: {
              managerId: viewer.userId,
            },
          }
        : undefined;

    const [auditEntries, recentAssignments] = await Promise.all([
      (() => {
        const qb = this.jobAuditLogsRepo
          .createQueryBuilder('audit')
          .innerJoinAndSelect('audit.job', 'job')
          .innerJoinAndSelect('job.customer', 'customer')
          .innerJoinAndSelect('audit.performedBy', 'performedBy')
          .where('performedBy.role = :managerRole', {
            managerRole: UserRole.MANAGER,
          });

        if (viewer?.role === UserRole.MANAGER) {
          qb.andWhere('job.managerId = :viewerId', {
            viewerId: viewer.userId,
          });
        }

        return qb.orderBy('audit.createdAt', 'DESC').take(take).getMany();
      })(),
      this.assignmentsRepo.find({
        where: assignmentsWhere,
        relations: {
          job: {
            customer: true,
          },
          staffUser: true,
        },
        order: {
          createdAt: 'DESC',
        },
        take,
      }),
    ]);

    const managerIds = Array.from(
      new Set(
        recentAssignments
          .map((assignment) => assignment.job?.managerId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const assignmentManagers =
      managerIds.length > 0
        ? await this.usersRepo.find({
            where: {
              id: In(managerIds),
              role: UserRole.MANAGER,
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          })
        : [];

    const managerById = new Map(
      assignmentManagers.map((manager) => [manager.id, manager]),
    );

    const auditItems: ManagerActivityItem[] = auditEntries.map((entry) => ({
      id: `audit_${entry.id}`,
      type: 'audit' as const,
      occurredAt: entry.createdAt.toISOString(),
      managerUserId: entry.performedById ?? '',
      managerName: this.getUserFullName(entry.performedBy),
      description: this.describeAuditEntry(entry),
      job: entry.job
        ? {
            id: entry.job.id,
            customerName: this.getCustomerFullName(entry.job.customer),
            summaryLabel: this.getJobSummaryLabel(entry.job),
          }
        : null,
    }));
    const assignmentItems = recentAssignments
      .map<ManagerActivityItem | null>((assignment) => {
        const manager = assignment.job
          ? managerById.get(assignment.job.managerId ?? '')
          : null;
        if (!manager || !assignment.job?.customer) {
          return null;
        }

        return {
          id: `assignment_${assignment.id}`,
          type: 'assignment',
          occurredAt: assignment.createdAt.toISOString(),
          managerUserId: manager.id,
          managerName: this.getUserFullName(manager),
          description: `Assigned ${this.getUserFullName(assignment.staffUser)}`,
          job: {
            id: assignment.job.id,
            customerName: this.getCustomerFullName(assignment.job.customer),
            summaryLabel: this.getJobSummaryLabel(assignment.job),
          },
        };
      })
      .filter((value): value is ManagerActivityItem => value !== null);

    const items: ManagerActivityItem[] = [...auditItems, ...assignmentItems]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, safeLimit);

    return {
      generatedAt: new Date().toISOString(),
      items,
    };
  }

  private buildActiveInvoiceCountByJobId(invoices: InvoiceProjection[]) {
    const counts = new Map<string, number>();

    invoices.forEach((invoice) => {
      if (!invoice.jobId || invoice.status === InvoiceStatus.CANCELLED) {
        return;
      }

      counts.set(invoice.jobId, (counts.get(invoice.jobId) ?? 0) + 1);
    });

    return counts;
  }

  private buildPaidAmountByJobId(invoices: InvoiceProjection[]) {
    const paidAmounts = new Map<string, number>();

    invoices.forEach((invoice) => {
      if (!invoice.jobId || invoice.status === InvoiceStatus.CANCELLED) {
        return;
      }

      const paidAmount = Number(invoice.amountPaid ?? 0);
      paidAmounts.set(
        invoice.jobId,
        (paidAmounts.get(invoice.jobId) ?? 0) + paidAmount,
      );
    });

    return paidAmounts;
  }

  private countUnpaidInvoices(invoices: InvoiceProjection[]) {
    return invoices.filter((invoice) => {
      if (invoice.status === InvoiceStatus.CANCELLED) {
        return false;
      }

      return (
        Number(invoice.total ?? 0) - Number(invoice.amountPaid ?? 0) > 0.0001
      );
    }).length;
  }

  private buildLatestMeterStatusByJobId(
    meterApplications: Array<
      Pick<MeterApplication, 'jobId' | 'type' | 'status' | 'updatedAt'>
    >,
  ) {
    const statusByJobId = new Map<
      string,
      Partial<Record<MeterStatusKey, MeterApplication['status']>>
    >();
    const timestampByCompositeKey = new Map<string, number>();

    meterApplications.forEach((application) => {
      if (
        application.type !== 'pre_meter' &&
        application.type !== 'post_meter'
      ) {
        return;
      }

      const compositeKey = `${application.jobId}:${application.type}`;
      const timestamp = application.updatedAt.getTime();
      const previousTimestamp = timestampByCompositeKey.get(compositeKey) ?? 0;

      if (timestamp < previousTimestamp) {
        return;
      }

      timestampByCompositeKey.set(compositeKey, timestamp);
      statusByJobId.set(application.jobId, {
        ...(statusByJobId.get(application.jobId) ?? {}),
        [application.type]: application.status,
      });
    });

    return statusByJobId;
  }

  private isWaitingPreMeterStage(stage: string) {
    return [
      'lead',
      'quoted',
      'won',
      'pre_meter_submitted',
      'pre_meter_approved',
      'scheduled',
    ].includes(stage);
  }

  private isWaitingPostMeterStage(stage: string) {
    return [
      'installed',
      'post_meter_submitted',
      'completed',
      'invoiced',
    ].includes(stage);
  }

  private isNotInvoicedStage(stage: string) {
    return [
      'won',
      'scheduled',
      'installed',
      'post_meter_submitted',
      'completed',
    ].includes(stage);
  }

  private describeAuditEntry(entry: JobAuditLog) {
    switch (entry.action) {
      case JobAuditAction.JOB_CREATED:
        return 'Created the job';
      case JobAuditAction.JOB_STATUS_CHANGED:
        return `Changed stage from ${this.humanizeValue(entry.oldValue)} to ${this.humanizeValue(entry.newValue)}`;
      case JobAuditAction.MANAGER_ASSIGNMENT_CHANGED:
        return 'Updated manager assignment';
      case JobAuditAction.INSTALLER_ASSIGNED:
        return 'Assigned an installer';
      case JobAuditAction.INSTALLER_REMOVED:
        return 'Removed an installer';
      case JobAuditAction.CONTRACT_SIGNED_CHANGED:
        return 'Updated contract signed status';
      case JobAuditAction.DEPOSIT_PAID_CHANGED:
        return 'Updated deposit paid status';
      case JobAuditAction.INSTALL_DATE_CHANGED:
        return 'Updated install date';
      case JobAuditAction.PRE_METER_STATUS_CHANGED:
        return 'Updated pre-meter status';
      case JobAuditAction.POST_METER_STATUS_CHANGED:
        return 'Updated post-meter status';
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

    return 'unknown';
  }

  private humanizeToken(value: string) {
    return value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  private getUserFullName(user: Pick<User, 'firstName' | 'lastName'> | null) {
    if (!user) return 'Unknown manager';
    return `${user.firstName.trim()} ${user.lastName.trim()}`.trim();
  }

  private getCustomerFullName(
    customer: Pick<Customer, 'firstName' | 'lastName'> | null,
  ) {
    if (!customer) return 'Unknown customer';
    return `${customer.firstName.trim()} ${customer.lastName.trim()}`.trim();
  }

  private getJobSummaryLabel(
    job: Pick<Job, 'systemSizeKw' | 'batterySizeKwh'> | null,
  ) {
    if (!job) return null;

    const systemKw = Number(job.systemSizeKw ?? 0);
    const batteryKwh = Number(job.batterySizeKwh ?? 0);

    if (systemKw > 0 && batteryKwh > 0) {
      return `${this.formatNumeric(systemKw)} kW + ${this.formatNumeric(batteryKwh)} kWh`;
    }

    if (systemKw > 0) {
      return `${this.formatNumeric(systemKw)} kW`;
    }

    if (batteryKwh > 0) {
      return `${this.formatNumeric(batteryKwh)} kWh`;
    }

    return null;
  }

  private formatNumeric(value: number) {
    return Number.isInteger(value) ? value.toString() : value.toFixed(1);
  }

  private startOfWeek(baseDate: Date) {
    const result = new Date(baseDate);
    result.setHours(0, 0, 0, 0);
    result.setDate(result.getDate() - result.getDay());
    return result;
  }

  private addDays(baseDate: Date, days: number) {
    const result = new Date(baseDate);
    result.setHours(0, 0, 0, 0);
    result.setDate(result.getDate() + days);
    return result;
  }

  private formatDateOnly(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
