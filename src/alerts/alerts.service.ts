import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Alert } from './entities/alert.entity';
import { Job } from '../jobs/entities/job.entity';
import { JobPipelineStage } from '../jobs/job-pipeline-stage.enum';
import { STAGE_ORDER } from '../jobs/pipeline-gate.rules';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceStatus } from '../invoices/entities/invoice-status.enum';
import {
  AdminSettings,
  ADMIN_SETTINGS_SINGLETON_ID,
} from '../runtime-settings/admin-settings.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { AlertsQueryDto } from './dto/alerts-query.dto';
import {
  AlertResponseDto,
  AlertsListResponseDto,
} from './dto/alert-response.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ALERT_TYPE = {
  PRE_METER_PENDING_7_DAYS: 'PRE_METER_PENDING_7_DAYS',
  INSTALL_WITHIN_3_DAYS_PRE_METER_NOT_APPROVED:
    'INSTALL_WITHIN_3_DAYS_PRE_METER_NOT_APPROVED',
  POST_METER_NOT_SUBMITTED_2_DAYS_AFTER_INSTALL:
    'POST_METER_NOT_SUBMITTED_2_DAYS_AFTER_INSTALL',
  INVOICE_NOT_PAID_AFTER_X_DAYS: 'INVOICE_NOT_PAID_AFTER_X_DAYS',
} as const;

type AlertType = (typeof ALERT_TYPE)[keyof typeof ALERT_TYPE];

const CRON_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the difference in whole days between two dates (a - b).
 * Ignores time-of-day by working with UTC midnight.
 */
function diffDays(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const aDay = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bDay = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((aDay - bDay) / msPerDay);
}

function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00Z');
}

const POST_METER_SUBMITTED_INDEX = STAGE_ORDER.indexOf(
  JobPipelineStage.POST_METER_SUBMITTED,
);

/**
 * "Post-meter submitted" must be judged by pipeline progress, not by the mere
 * existence of a post_meter row — job creation seeds a `pending` placeholder
 * row for every job, which would otherwise permanently exempt app-created
 * jobs from R3.
 */
function hasReachedPostMeterSubmission(job: Job): boolean {
  return (
    STAGE_ORDER.indexOf(job.pipelineStage as JobPipelineStage) >=
    POST_METER_SUBMITTED_INDEX
  );
}

function getJobReference(job: Job): string {
  const orderNumber = job.orderNumber?.trim();
  if (orderNumber) {
    return orderNumber;
  }

  return job.id;
}

function toResponseDto(alert: Alert): AlertResponseDto {
  return {
    id: alert.id,
    jobId: alert.jobId,
    type: alert.type,
    severity: alert.severity,
    message: alert.message,
    createdAt:
      alert.createdAt instanceof Date
        ? alert.createdAt.toISOString()
        : String(alert.createdAt),
    resolvedAt: alert.resolvedAt
      ? alert.resolvedAt instanceof Date
        ? alert.resolvedAt.toISOString()
        : String(alert.resolvedAt)
      : null,
    resolvedByUserId: alert.resolvedByUserId ?? null,
  };
}

// ─── Default settings fallback ────────────────────────────────────────────────

const DEFAULT_SETTINGS: Pick<
  AdminSettings,
  | 'preMeterPendingDays'
  | 'installWarningDays'
  | 'postMeterDeadlineDays'
  | 'invoiceOverdueDays'
> = {
  preMeterPendingDays: 7,
  installWarningDays: 3,
  postMeterDeadlineDays: 2,
  invoiceOverdueDays: 14,
};

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsService.name);
  private cronHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,

    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,

    @InjectRepository(MeterApplication)
    private readonly meterRepo: Repository<MeterApplication>,

    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,

    @InjectRepository(AdminSettings)
    private readonly settingsRepo: Repository<AdminSettings>,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.cronHandle = setInterval(() => {
      this.evaluateAndSync().catch((err: unknown) => {
        this.logger.error('Cron evaluateAndSync failed', err);
      });
    }, CRON_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.cronHandle !== null) {
      clearInterval(this.cronHandle);
      this.cronHandle = null;
    }
  }

  // ─── Rules Engine ─────────────────────────────────────────────────────────

  /**
   * Evaluate all 4 alert rules and upsert/auto-resolve alerts.
   * @param today — injectable for testing; defaults to new Date()
   */
  async evaluateAndSync(today: Date = new Date()): Promise<void> {
    const settings = await this.settingsRepo.findOne({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    });

    const {
      preMeterPendingDays,
      installWarningDays,
      postMeterDeadlineDays,
      invoiceOverdueDays,
    } = settings ?? DEFAULT_SETTINGS;

    // Load all jobs
    const jobs = await this.jobRepo.find();

    // Load all approved pre_meter applications (keyed by jobId)
    const approvedPreMeters = await this.meterRepo.find({
      where: { type: 'pre_meter', status: 'approved' },
    });
    const approvedPreMeterJobIds = new Set(
      approvedPreMeters.map((m) => m.jobId),
    );

    // Load approved post_meter applications (keyed by jobId). Pending rows
    // are ignored: creation seeds a pending placeholder for every job.
    const approvedPostMeters = await this.meterRepo.find({
      where: { type: 'post_meter', status: 'approved' },
    });
    const approvedPostMeterJobIds = new Set(
      approvedPostMeters.map((m) => m.jobId),
    );

    // Load all invoices with a jobId
    const invoices = await this.invoiceRepo.find();
    // Group by jobId
    const invoicesByJobId = new Map<string, Invoice[]>();
    for (const inv of invoices) {
      if (!inv.jobId) continue;
      const existing = invoicesByJobId.get(inv.jobId) ?? [];
      existing.push(inv);
      invoicesByJobId.set(inv.jobId, existing);
    }

    // Load all currently active alerts (resolvedAt IS NULL)
    const activeAlerts = await this.alertRepo.find({
      where: { resolvedAt: IsNull() },
    });

    // Build a map: `${jobId}::${type}` → Alert
    const activeAlertMap = new Map<string, Alert>();
    for (const a of activeAlerts) {
      activeAlertMap.set(`${a.jobId}::${a.type}`, a);
    }

    // Collect which (jobId, type) pairs SHOULD be active after this run
    const shouldBeActive = new Set<string>();
    const newlyCreatedAlerts: Alert[] = [];

    for (const job of jobs) {
      const jobAlerts = this.computeRulesForJob(
        job,
        approvedPreMeterJobIds,
        approvedPostMeterJobIds,
        invoicesByJobId.get(job.id) ?? [],
        today,
        preMeterPendingDays,
        installWarningDays,
        postMeterDeadlineDays,
        invoiceOverdueDays,
      );

      for (const { type, severity, message } of jobAlerts) {
        const key = `${job.id}::${type}`;
        shouldBeActive.add(key);

        if (!activeAlertMap.has(key)) {
          // Insert new alert
          const newAlert = this.alertRepo.create({
            jobId: job.id,
            type,
            severity,
            message,
            resolvedAt: null,
            resolvedByUserId: null,
          });
          const savedAlert = await this.alertRepo.save(newAlert);
          newlyCreatedAlerts.push(savedAlert);
        }
        // If already active → skip (idempotent)
      }
    }

    // Auto-resolve alerts whose condition is no longer true
    for (const [key, alert] of activeAlertMap) {
      if (!shouldBeActive.has(key)) {
        await this.alertRepo.save({
          ...alert,
          resolvedAt: new Date(),
          resolvedByUserId: null,
        });
      }
    }

    for (const alert of newlyCreatedAlerts) {
      // Overdue invoices notify regardless of severity — admins asked for a
      // dedicated invoice alert stream on mobile, not just high-sev alerts.
      if (alert.type === ALERT_TYPE.INVOICE_NOT_PAID_AFTER_X_DAYS) {
        const overdueJob = jobs.find((job) => job.id === alert.jobId);
        const payload = {
          type: NOTIFICATION_TYPE.INVOICE_OVERDUE,
          title: 'Invoice overdue',
          body: alert.message,
          metadata: {
            alertId: alert.id,
            jobId: alert.jobId,
            orderNumber: overdueJob?.orderNumber ?? null,
          },
          dedupeKey: `invoice-overdue:${alert.id}:admins`,
        };
        await this.notificationsService.sendToRole(UserRole.ADMIN, payload);
        if (overdueJob?.managerId) {
          await this.notificationsService.sendToUser(overdueJob.managerId, {
            ...payload,
            dedupeKey: `invoice-overdue:${alert.id}:manager`,
          });
        }
      }

      if (alert.severity !== 'high') {
        continue;
      }

      const relatedJob = jobs.find((job) => job.id === alert.jobId);
      if (!relatedJob) {
        continue;
      }

      await this.notificationsService.sendToRole(UserRole.ADMIN, {
        type: NOTIFICATION_TYPE.HIGH_SEVERITY_ALERT_CREATED,
        title: 'High severity operational alert',
        body: alert.message,
        metadata: {
          alertId: alert.id,
          jobId: alert.jobId,
          orderNumber: relatedJob.orderNumber,
          alertType: alert.type,
          severity: alert.severity,
        },
        dedupeKey: `high-alert:${alert.id}:admins`,
      });

      if (relatedJob.managerId) {
        await this.notificationsService.sendToUser(relatedJob.managerId, {
          type: NOTIFICATION_TYPE.HIGH_SEVERITY_ALERT_CREATED,
          title: 'High severity operational alert',
          body: alert.message,
          metadata: {
            alertId: alert.id,
            jobId: alert.jobId,
            orderNumber: relatedJob.orderNumber,
            alertType: alert.type,
            severity: alert.severity,
            managerId: relatedJob.managerId,
          },
          dedupeKey: `high-alert:${alert.id}:${relatedJob.managerId}`,
        });
      }
    }
  }

  private computeRulesForJob(
    job: Job,
    approvedPreMeterJobIds: Set<string>,
    approvedPostMeterJobIds: Set<string>,
    jobInvoices: Invoice[],
    today: Date,
    preMeterPendingDays: number,
    installWarningDays: number,
    postMeterDeadlineDays: number,
    invoiceOverdueDays: number,
  ): Array<{ type: AlertType; severity: string; message: string }> {
    const results: Array<{
      type: AlertType;
      severity: string;
      message: string;
    }> = [];
    const hasApprovedPreMeter = approvedPreMeterJobIds.has(job.id);
    const jobReference = getJobReference(job);

    if (job.installDate) {
      const installDate = parseDate(job.installDate);
      const daysUntilInstall = diffDays(installDate, today);

      // R1: installDate > today AND installDate <= today + preMeterPendingDays
      if (
        daysUntilInstall > 0 &&
        daysUntilInstall <= preMeterPendingDays &&
        !hasApprovedPreMeter
      ) {
        results.push({
          type: ALERT_TYPE.PRE_METER_PENDING_7_DAYS,
          severity: 'high',
          message:
            'Pre-meter not approved and install date is approaching for job ' +
            jobReference,
        });
      }

      // R2: installDate > today AND installDate <= today + installWarningDays
      if (
        daysUntilInstall > 0 &&
        daysUntilInstall <= installWarningDays &&
        !hasApprovedPreMeter
      ) {
        results.push({
          type: ALERT_TYPE.INSTALL_WITHIN_3_DAYS_PRE_METER_NOT_APPROVED,
          severity: 'high',
          message:
            'Install is within ' +
            installWarningDays +
            ' days and pre-meter is not approved for job ' +
            jobReference,
        });
      }

      // R3: installDate has passed AND days since install > postMeterDeadlineDays
      // AND the pipeline hasn't reached post_meter_submitted (an approved
      // post_meter row also counts as submitted, for direct metering flows).
      const daysSinceInstall = diffDays(today, installDate);
      if (
        daysSinceInstall > postMeterDeadlineDays &&
        !hasReachedPostMeterSubmission(job) &&
        !approvedPostMeterJobIds.has(job.id)
      ) {
        results.push({
          type: ALERT_TYPE.POST_METER_NOT_SUBMITTED_2_DAYS_AFTER_INSTALL,
          severity: 'medium',
          message:
            'Post-meter not submitted more than ' +
            postMeterDeadlineDays +
            ' days after install for job ' +
            jobReference,
        });
      }
    }

    // R4: invoice.dueDate + invoiceOverdueDays days < today AND status NOT IN ['PAID', 'CANCELLED']
    for (const invoice of jobInvoices) {
      if (
        invoice.status === InvoiceStatus.PAID ||
        invoice.status === InvoiceStatus.CANCELLED
      ) {
        continue;
      }
      const dueDate = parseDate(invoice.dueDate);
      // deadline = dueDate + invoiceOverdueDays
      const deadlineDate = new Date(dueDate);
      deadlineDate.setDate(deadlineDate.getDate() + invoiceOverdueDays);
      // alert fires when deadline < today  →  diffDays(today, deadline) > 0
      if (diffDays(today, deadlineDate) > 0) {
        results.push({
          type: ALERT_TYPE.INVOICE_NOT_PAID_AFTER_X_DAYS,
          severity: 'medium',
          message:
            'Invoice not paid after ' +
            invoiceOverdueDays +
            ' days past due date for job ' +
            jobReference,
        });
        break; // one alert per job is enough
      }
    }

    return results;
  }

  // ─── Evaluate endpoint (admin-triggered) ──────────────────────────────────

  async evaluateEndpoint(): Promise<{ message: string }> {
    await this.evaluateAndSync();
    return { message: 'Alert evaluation completed' };
  }

  // ─── Query ────────────────────────────────────────────────────────────────

  async findAlerts(
    filters: AlertsQueryDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<AlertsListResponseDto> {
    const { status = 'active', severity, type } = filters;

    // Every filter is pushed into a single DB query — including the
    // resolution-status predicate and role scoping — so no branch loads the
    // whole alerts table into memory.
    const where: Record<string, unknown> = {};

    if (status === 'active') {
      where['resolvedAt'] = IsNull();
    } else if (status === 'resolved') {
      where['resolvedAt'] = Not(IsNull());
    }
    // status === 'all' → no filter on resolvedAt

    if (severity) {
      where['severity'] = severity;
    }

    if (type) {
      where['type'] = type;
    }

    const installerMine =
      viewer.role === UserRole.INSTALLER &&
      (filters.scope === 'mine' || filters.scope === undefined);

    // Role scoping as a joined-relation predicate (manager: own jobs;
    // installer `mine`: assigned jobs).
    if (viewer.role === UserRole.MANAGER) {
      where['job'] = { managerId: viewer.userId };
    } else if (installerMine) {
      where['job'] = { assignedStaffUserId: viewer.userId };
    }

    const needsJobRelation = viewer.role === UserRole.MANAGER || installerMine;
    const alerts = await this.alertRepo.find({
      where,
      relations: needsJobRelation ? ['job'] : undefined,
      order: { createdAt: 'DESC' },
    });

    return {
      items: alerts.map(toResponseDto),
      total: alerts.length,
    };
  }

  // ─── Resolve single ───────────────────────────────────────────────────────

  async resolveAlert(
    id: string,
    userId: string,
    role: UserRole,
  ): Promise<AlertResponseDto> {
    const alert = await this.alertRepo.findOne({ where: { id } });

    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }

    if (alert.resolvedAt !== null) {
      throw new ConflictException(`Alert ${id} is already resolved`);
    }

    if (role === UserRole.MANAGER) {
      const job = await this.jobRepo.findOne({ where: { id: alert.jobId } });
      if (!job || job.managerId !== userId) {
        throw new ForbiddenException(
          'You can only resolve alerts for your own jobs',
        );
      }
    }

    const saved = await this.alertRepo.save({
      ...alert,
      resolvedAt: new Date(),
      resolvedByUserId: userId,
    });

    return toResponseDto(saved);
  }

  // ─── Resolve all ──────────────────────────────────────────────────────────

  async resolveAll(viewer: {
    userId: string;
    role: UserRole;
  }): Promise<{ resolved: number }> {
    const where: Record<string, unknown> = { resolvedAt: IsNull() };

    if (viewer.role === UserRole.MANAGER) {
      where['job'] = { managerId: viewer.userId };
    }

    const alerts = await this.alertRepo.find({
      where,
      relations: viewer.role === UserRole.MANAGER ? ['job'] : undefined,
    });

    if (alerts.length === 0) {
      return { resolved: 0 };
    }

    const now = new Date();
    const toSave = alerts.map((a) => ({
      ...a,
      resolvedAt: now,
      resolvedByUserId: viewer.userId,
    }));

    await this.alertRepo.save(toSave);

    return { resolved: alerts.length };
  }
}
