import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alert } from '../alerts/entities/alert.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceStatus } from '../invoices/entities/invoice-status.enum';
import { Job } from '../jobs/entities/job.entity';
import { JobPipelineStage } from '../jobs/job-pipeline-stage.enum';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { UserRole } from '../users/entities/user-role.enum';

type DashboardPayload = Record<string, unknown>;

type FunnelStage = {
  label: string;
  count: number;
  tone: string;
};

@Injectable()
export class MobileDashboardService {
  constructor(
    @InjectRepository(Job) private readonly jobsRepo: Repository<Job>,
    @InjectRepository(Alert) private readonly alertsRepo: Repository<Alert>,
    @InjectRepository(Invoice)
    private readonly invoicesRepo: Repository<Invoice>,
    @InjectRepository(MeterApplication)
    private readonly meterAppsRepo: Repository<MeterApplication>,
  ) {}

  async getDashboard(
    role: UserRole,
    userId: string,
  ): Promise<{ role: UserRole; kpis: DashboardPayload }> {
    switch (role) {
      case UserRole.ADMIN:
        return { role, kpis: await this.adminKpis() };
      case UserRole.MANAGER:
        return { role, kpis: await this.managerKpis(userId) };
      case UserRole.INSTALLER:
      default:
        return {
          role: UserRole.INSTALLER,
          kpis: await this.installerKpis(userId),
        };
    }
  }

  private async adminKpis(): Promise<DashboardPayload> {
    const activeJobs = await this.jobsRepo.count();
    const overdueInvoices = await this.invoicesRepo.find({
      where: { status: InvoiceStatus.OVERDUE },
      select: ['id', 'total'],
    });
    const overdueTotal = overdueInvoices.reduce(
      (sum, inv) => sum + Number(inv.total ?? 0),
      0,
    );

    const [
      pipelineFunnel,
      revenueMonthCents,
      revenueLastMonthCents,
      revenueTrend,
      conversion,
      cycleDays,
    ] = await Promise.all([
      this.buildPipelineFunnel(),
      this.sumPaidRevenueCentsForMonth(0),
      this.sumPaidRevenueCentsForMonth(-1),
      this.buildRevenueTrend(),
      this.computeConversionRate(),
      this.computeAverageCycleDays(),
    ]);

    return {
      activeJobs,
      overdueCount: overdueInvoices.length,
      overdueTotal,
      revenueMonthCents,
      revenueLastMonthCents,
      revenueTrend,
      pipelineFunnel,
      conversion,
      conversionRate: conversion,
      cycleDays,
    };
  }

  private async countJobsInStages(stages: JobPipelineStage[]): Promise<number> {
    if (stages.length === 0) {
      return 0;
    }
    return this.jobsRepo
      .createQueryBuilder('job')
      .where('job.pipelineStage IN (:...stages)', { stages })
      .getCount();
  }

  private async buildPipelineFunnel(): Promise<FunnelStage[]> {
    const [lead, won, scheduled, installed, paid] = await Promise.all([
      this.countJobsInStages([JobPipelineStage.LEAD, JobPipelineStage.QUOTED]),
      this.countJobsInStages([
        JobPipelineStage.WON,
        JobPipelineStage.PRE_METER_SUBMITTED,
        JobPipelineStage.PRE_METER_APPROVED,
      ]),
      this.countJobsInStages([JobPipelineStage.SCHEDULED]),
      this.countJobsInStages([
        JobPipelineStage.INSTALLED,
        JobPipelineStage.POST_METER_SUBMITTED,
        JobPipelineStage.COMPLETED,
      ]),
      this.countJobsInStages([
        JobPipelineStage.INVOICED,
        JobPipelineStage.PAID,
      ]),
    ]);

    return [
      { label: 'Lead', count: lead, tone: 'neutral' },
      { label: 'Won', count: won, tone: 'info' },
      { label: 'Scheduled', count: scheduled, tone: 'accent' },
      { label: 'Installed', count: installed, tone: 'success' },
      { label: 'Paid', count: paid, tone: 'teal' },
    ];
  }

  private monthWindow(monthOffset: number): { start: string; end: string } {
    const now = new Date();
    const anchor = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const start = anchor.toISOString().slice(0, 10);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);
    return { start, end };
  }

  // Current ISO week (Monday 00:00 → Sunday), as inclusive YYYY-MM-DD bounds to
  // match how the `date`-typed job columns (installDate/scheduledDate) compare.
  private weekWindow(): { start: string; end: string } {
    const now = new Date();
    const day = now.getDay(); // 0=Sun..6=Sat
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + mondayOffset,
    );
    const sunday = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + 6,
    );
    return {
      start: monday.toISOString().slice(0, 10),
      end: sunday.toISOString().slice(0, 10),
    };
  }

  private async sumPaidRevenueCentsForMonth(
    monthOffset: number,
  ): Promise<number> {
    const { start, end } = this.monthWindow(monthOffset);
    const rows = await this.invoicesRepo
      .createQueryBuilder('invoice')
      .select('invoice.total', 'total')
      .where('invoice.status = :status', { status: InvoiceStatus.PAID })
      .andWhere('invoice.issueDate >= :start', { start })
      .andWhere('invoice.issueDate <= :end', { end })
      .getRawMany<{ total: string }>();

    const dollars = rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    return Math.round(dollars * 100);
  }

  private async buildRevenueTrend(): Promise<number[]> {
    const centsByMonth: number[] = [];
    for (let offset = -11; offset <= 0; offset += 1) {
      centsByMonth.push(await this.sumPaidRevenueCentsForMonth(offset));
    }
    const max = Math.max(...centsByMonth, 1);
    return centsByMonth.map((c) => Number((c / max).toFixed(2)));
  }

  private async computeConversionRate(): Promise<number> {
    const [quoted, won] = await Promise.all([
      this.countJobsInStages([JobPipelineStage.QUOTED]),
      this.countJobsInStages([
        JobPipelineStage.WON,
        JobPipelineStage.PRE_METER_SUBMITTED,
        JobPipelineStage.PRE_METER_APPROVED,
        JobPipelineStage.SCHEDULED,
        JobPipelineStage.INSTALLED,
        JobPipelineStage.POST_METER_SUBMITTED,
        JobPipelineStage.COMPLETED,
        JobPipelineStage.INVOICED,
        JobPipelineStage.PAID,
      ]),
    ]);
    const denominator = quoted + won;
    if (denominator === 0) {
      return 0;
    }
    return Math.round((won / denominator) * 100);
  }

  private async computeAverageCycleDays(): Promise<number> {
    const rows = await this.jobsRepo
      .createQueryBuilder('job')
      .select('job.createdAt', 'createdAt')
      .addSelect('job.updatedAt', 'updatedAt')
      .where('job.pipelineStage IN (:...stages)', {
        stages: [
          JobPipelineStage.INSTALLED,
          JobPipelineStage.POST_METER_SUBMITTED,
          JobPipelineStage.COMPLETED,
          JobPipelineStage.INVOICED,
          JobPipelineStage.PAID,
        ],
      })
      .getRawMany<{ createdAt: Date; updatedAt: Date }>();

    if (rows.length === 0) {
      return 0;
    }

    const totalDays = rows.reduce((sum, row) => {
      const created = new Date(row.createdAt).getTime();
      const updated = new Date(row.updatedAt).getTime();
      const days = Math.max(0, Math.round((updated - created) / 86_400_000));
      return sum + days;
    }, 0);

    return Math.round(totalDays / rows.length);
  }

  private async managerKpis(userId: string): Promise<DashboardPayload> {
    const managedJobs = await this.jobsRepo.count({
      where: { managerId: userId },
    });
    const alerts = await this.alertsRepo
      .createQueryBuilder('alert')
      .innerJoin('alert.job', 'job', 'job.managerId = :managerId', {
        managerId: userId,
      })
      .where('alert.resolvedAt IS NULL')
      .getCount();

    const { start, end } = this.weekWindow();

    const [installsWeek, kwBookedRow, pendingPreMeter, pendingPostMeter] =
      await Promise.all([
        // Jobs installed this week (installDate within the current ISO week).
        this.jobsRepo
          .createQueryBuilder('job')
          .where('job.managerId = :managerId', { managerId: userId })
          .andWhere('job.installDate IS NOT NULL')
          .andWhere('job.installDate >= :start', { start })
          .andWhere('job.installDate <= :end', { end })
          .getCount(),
        // kW booked = sum of systemSizeKw for jobs scheduled this week.
        this.jobsRepo
          .createQueryBuilder('job')
          .select('COALESCE(SUM(job.systemSizeKw), 0)', 'kw')
          .where('job.managerId = :managerId', { managerId: userId })
          .andWhere('job.scheduledDate IS NOT NULL')
          .andWhere('job.scheduledDate >= :start', { start })
          .andWhere('job.scheduledDate <= :end', { end })
          .getRawOne<{ kw: string }>(),
        // Pending pre/post-meter applications on this manager's jobs.
        this.meterAppsRepo
          .createQueryBuilder('app')
          .innerJoin('app.job', 'job', 'job.managerId = :managerId', {
            managerId: userId,
          })
          .where('app.type = :type', { type: 'pre_meter' })
          .andWhere('app.status = :status', { status: 'pending' })
          .getCount(),
        this.meterAppsRepo
          .createQueryBuilder('app')
          .innerJoin('app.job', 'job', 'job.managerId = :managerId', {
            managerId: userId,
          })
          .where('app.type = :type', { type: 'post_meter' })
          .andWhere('app.status = :status', { status: 'pending' })
          .getCount(),
      ]);

    const kwBooked = Number(kwBookedRow?.kw ?? 0);

    return {
      installsWeek,
      kwBooked,
      pendingPreMeter,
      pendingPostMeter,
      alerts,
      managedJobs,
    };
  }

  private async installerKpis(userId: string): Promise<DashboardPayload> {
    const assignedJobs = await this.jobsRepo.count({
      where: { assignedStaffUserId: userId },
    });
    return {
      assignedJobs,
      todayJobs: 0,
      openAlerts: 0,
    };
  }
}
