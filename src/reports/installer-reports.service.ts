import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { AttendanceRecord } from '../attendance/entities/attendance-record.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';

/** Pipeline stages that count as a completed install for reporting. */
const INSTALLED_STAGES = ['completed', 'invoiced', 'paid'];

const RECENT_JOBS_CAP = 10;
const DEFAULT_RANGE_DAYS = 180;
const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

type ReportsViewer = {
  userId: string;
  role: UserRole;
  reportScope?: 'all' | 'own';
};

type InstallerLeaderboardRow = {
  id: string;
  name: string;
  initials: string;
  hue: number;
  installs: number;
  kwInstalled: number;
  onTimePercent: number;
};

type InstallerLeaderboardResponse = {
  generatedAt: string;
  range: { from: string; to: string };
  installers: InstallerLeaderboardRow[];
};

type InstallerDetailResponse = InstallerLeaderboardRow & {
  generatedAt: string;
  range: { from: string; to: string };
  title: string | null;
  phone: string | null;
  monthlyInstalls: Array<{ label: string; installs: number }>;
  accreditations: Array<{
    label: string;
    value: string;
    expiry: string | null;
    valid: boolean;
  }>;
  recentJobs: Array<{
    id: string;
    orderNumber: string;
    customerLabel: string;
    suburb: string | null;
    installDate: string | null;
    pipelineStage: string | null;
    systemSizeKw: number | null;
    systemType: string | null;
  }>;
};

@Injectable()
export class InstallerReportsService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    @InjectRepository(AttendanceRecord)
    private readonly attendanceRepo: Repository<AttendanceRecord>,
  ) {}

  async getLeaderboard(
    query: { from?: string; to?: string },
    viewer?: ReportsViewer,
  ): Promise<InstallerLeaderboardResponse> {
    const now = new Date();
    const range = this.resolveRange(query.from, query.to, now);
    const installers = await this.loadActiveInstallers();
    const metrics = await this.computeMetrics(
      installers.map((user) => user.id),
      range,
      viewer,
    );

    const rows = installers
      .map((user) => this.toLeaderboardRow(user, metrics))
      .sort(
        (left, right) =>
          right.installs - left.installs ||
          right.kwInstalled - left.kwInstalled ||
          left.name.localeCompare(right.name),
      );

    return {
      generatedAt: now.toISOString(),
      range: { from: range.from, to: range.to },
      installers: rows,
    };
  }

  async getInstallerDetail(
    installerId: string,
    query: { from?: string; to?: string },
    viewer?: ReportsViewer,
  ): Promise<InstallerDetailResponse> {
    const now = new Date();
    const range = this.resolveRange(query.from, query.to, now);
    const installer = await this.usersRepo.findOne({
      where: {
        id: installerId,
        role: UserRole.INSTALLER,
        active: true,
        deletedAt: IsNull(),
      },
      relations: { staffRole: true, employeeRole: true },
    });
    if (!installer) {
      throw new NotFoundException('Installer not found');
    }

    const metrics = await this.computeMetrics([installer.id], range, viewer);
    const row = this.toLeaderboardRow(installer, metrics);
    const bucket = metrics.get(installer.id);

    return {
      generatedAt: now.toISOString(),
      range: { from: range.from, to: range.to },
      ...row,
      title:
        installer.staffRole?.name ??
        installer.employeeRole?.name ??
        'Installer',
      phone: installer.phoneNumber || null,
      monthlyInstalls: this.buildMonthlyInstalls(
        bucket?.installMonths ?? [],
        now,
      ),
      // No accreditation storage exists yet; empty keeps the client contract.
      accreditations: [],
      recentJobs: bucket?.recentJobs ?? [],
    };
  }

  /**
   * One assignments query (join job + customer) and one attendance query for
   * all requested installers — no per-installer round-trips.
   */
  private async computeMetrics(
    installerIds: string[],
    range: { from: string; to: string },
    viewer?: ReportsViewer,
  ) {
    type Bucket = {
      installs: number;
      kwInstalled: number;
      dueAssignments: number;
      onTimeAssignments: number;
      installMonths: string[];
      recentJobs: InstallerDetailResponse['recentJobs'];
    };
    const buckets = new Map<string, Bucket>();
    if (installerIds.length === 0) {
      return buckets;
    }

    const qb = this.assignmentsRepo
      .createQueryBuilder('assignment')
      .innerJoinAndSelect('assignment.job', 'job')
      .leftJoinAndSelect('job.customer', 'customer')
      .where('assignment.staffUserId IN (:...installerIds)', { installerIds })
      .andWhere('assignment.scheduledDate >= :from', { from: range.from })
      .andWhere('assignment.scheduledDate <= :to', { to: range.to });

    if (this.isScopedToViewer(viewer) && viewer?.role === UserRole.MANAGER) {
      qb.andWhere('job.managerId = :viewerId', { viewerId: viewer.userId });
    }

    const assignments = await qb
      .orderBy('assignment.scheduledDate', 'DESC')
      .getMany();

    const attendance =
      assignments.length > 0
        ? await this.attendanceRepo.find({
            where: { staffId: In(installerIds) },
            select: { staffId: true, jobId: true, clockInAt: true },
          })
        : [];
    const attendedDays = new Set(
      attendance.map(
        (record) =>
          `${record.staffId}|${record.jobId}|${this.dateOnly(record.clockInAt)}`,
      ),
    );

    const today = this.dateOnly(new Date());
    const countedJobs = new Map<string, Set<string>>();

    for (const assignment of assignments) {
      const staffId = assignment.staffUserId;
      let bucket = buckets.get(staffId);
      if (!bucket) {
        bucket = {
          installs: 0,
          kwInstalled: 0,
          dueAssignments: 0,
          onTimeAssignments: 0,
          installMonths: [],
          recentJobs: [],
        };
        buckets.set(staffId, bucket);
      }

      if (assignment.scheduledDate <= today) {
        bucket.dueAssignments += 1;
        if (
          attendedDays.has(
            `${staffId}|${assignment.jobId}|${assignment.scheduledDate}`,
          )
        ) {
          bucket.onTimeAssignments += 1;
        }
      }

      let seen = countedJobs.get(staffId);
      if (!seen) {
        seen = new Set<string>();
        countedJobs.set(staffId, seen);
      }
      if (seen.has(assignment.jobId)) {
        continue;
      }
      seen.add(assignment.jobId);

      const job = assignment.job;
      if (INSTALLED_STAGES.includes(job.pipelineStage)) {
        bucket.installs += 1;
        bucket.kwInstalled += Number(job.systemSizeKw ?? 0) || 0;
        bucket.installMonths.push(
          (job.installDate ?? assignment.scheduledDate).slice(0, 7),
        );
      }

      if (bucket.recentJobs.length < RECENT_JOBS_CAP) {
        const customer = job.customer;
        bucket.recentJobs.push({
          id: job.id,
          orderNumber: job.orderNumber,
          customerLabel: customer
            ? `${customer.firstName} ${customer.lastName}`.trim()
            : 'Customer',
          suburb: this.suburbFromAddress(customer?.address ?? null),
          installDate: job.installDate ?? assignment.scheduledDate,
          pipelineStage: job.pipelineStage ?? null,
          systemSizeKw:
            job.systemSizeKw !== null && job.systemSizeKw !== undefined
              ? Number(job.systemSizeKw)
              : null,
          systemType: job.systemType ?? null,
        });
      }
    }

    return buckets;
  }

  private toLeaderboardRow(
    user: User,
    metrics: Map<
      string,
      {
        installs: number;
        kwInstalled: number;
        dueAssignments: number;
        onTimeAssignments: number;
      }
    >,
  ): InstallerLeaderboardRow {
    const bucket = metrics.get(user.id);
    const name = `${user.firstName} ${user.lastName}`.trim();
    return {
      id: user.id,
      name,
      initials: this.initialsFor(user.firstName, user.lastName),
      hue: this.hueFor(user.id),
      installs: bucket?.installs ?? 0,
      kwInstalled: Math.round(bucket?.kwInstalled ?? 0),
      onTimePercent:
        bucket && bucket.dueAssignments > 0
          ? Math.round((bucket.onTimeAssignments / bucket.dueAssignments) * 100)
          : 0,
    };
  }

  private loadActiveInstallers() {
    return this.usersRepo.find({
      where: { role: UserRole.INSTALLER, active: true, deletedAt: IsNull() },
      order: { firstName: 'ASC', lastName: 'ASC' },
    });
  }

  /** Last 6 calendar months ending this month, short labels (Jan…Dec). */
  private buildMonthlyInstalls(installMonths: string[], now: Date) {
    const counts = new Map<string, number>();
    for (const month of installMonths) {
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }
    const points: Array<{ label: string; installs: number }> = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
      );
      const key = `${date.getUTCFullYear()}-${String(
        date.getUTCMonth() + 1,
      ).padStart(2, '0')}`;
      points.push({
        label: MONTH_SHORT_NAMES[date.getUTCMonth()],
        installs: counts.get(key) ?? 0,
      });
    }
    return points;
  }

  private resolveRange(
    from: string | undefined,
    to: string | undefined,
    now: Date,
  ) {
    if ((from && !to) || (!from && to)) {
      throw new BadRequestException(
        'Both `from` and `to` are required when filtering by explicit dates.',
      );
    }
    if (from && to) {
      const normalizedFrom = from.slice(0, 10);
      const normalizedTo = to.slice(0, 10);
      if (normalizedFrom > normalizedTo) {
        throw new BadRequestException('`from` must be on or before `to`.');
      }
      return { from: normalizedFrom, to: normalizedTo };
    }
    const end = new Date(now.getTime() + 86400000);
    const start = new Date(now.getTime() - (DEFAULT_RANGE_DAYS - 1) * 86400000);
    return { from: this.dateOnly(start), to: this.dateOnly(end) };
  }

  private isScopedToViewer(viewer?: ReportsViewer): boolean {
    if (!viewer || viewer.role === UserRole.ADMIN) {
      return false;
    }
    return viewer.reportScope !== 'all';
  }

  private initialsFor(firstName: string, lastName: string) {
    const first = (firstName ?? '').trim();
    const last = (lastName ?? '').trim();
    const initials = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
    return initials || '?';
  }

  /** Deterministic avatar hue (0–359) from the user id. */
  private hueFor(id: string) {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
      hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
    }
    return hash % 360;
  }

  private suburbFromAddress(address: string | null) {
    if (!address) {
      return null;
    }
    const parts = address
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    return parts.length > 1 ? parts[1] : null;
  }

  private dateOnly(value: Date) {
    return value.toISOString().slice(0, 10);
  }
}
