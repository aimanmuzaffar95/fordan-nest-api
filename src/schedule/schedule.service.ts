import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { GetScheduleQueryDto } from './dto/get-schedule-query.dto';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';

export type ScheduleViewer = { userId: string; role: UserRole };

export type ScheduleItemDto = {
  assignmentId: string;
  jobId: string;
  customerId: string;
  systemSizeKw: number;
  staffUserId: string;
  staffName: string;
  scheduledDate: string;
  slot: string;
  locked: boolean;
};

export type ScheduleDailyInstallerDto = {
  scheduledDate: string;
  staffUserId: string;
  staffName: string;
  assignmentCount: number;
  bookedKw: number;
};

export type ScheduleResponseDto = {
  from: string;
  to: string;
  items: ScheduleItemDto[];
  dailyLoadByInstaller: ScheduleDailyInstallerDto[];
};

const MAX_RANGE_DAYS = 366;

@Injectable()
export class ScheduleService {
  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    private readonly runtimeSettings: RuntimeSettingsService,
  ) {}

  async get(
    query: GetScheduleQueryDto,
    viewer: ScheduleViewer,
  ): Promise<ScheduleResponseDto> {
    const calendarScopeEnforced =
      await this.runtimeSettings.getCalendarScopeEnforced();
    const from = query.from.slice(0, 10);
    const to = query.to.slice(0, 10);

    const fromMs = ScheduleService.parseYmdUtc(from).getTime();
    const toMs = ScheduleService.parseYmdUtc(to).getTime();
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      throw new BadRequestException('Invalid from/to date');
    }
    if (fromMs > toMs) {
      throw new BadRequestException('from must be on or before to');
    }
    const spanDays = (toMs - fromMs) / 86_400_000 + 1;
    if (spanDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Date range too large (max ${MAX_RANGE_DAYS} days)`,
      );
    }

    const qb = this.assignmentRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.job', 'job')
      .leftJoinAndSelect('a.staffUser', 'staffUser')
      .where('a.scheduledDate >= :from', { from })
      .andWhere('a.scheduledDate <= :to', { to });

    if (viewer.role === UserRole.INSTALLER && calendarScopeEnforced) {
      qb.andWhere('a.staffUserId = :viewerId', { viewerId: viewer.userId });
    }

    if (viewer.role === UserRole.MANAGER && calendarScopeEnforced) {
      // Managers should see assignments for jobs they manage, not rows where they
      // happen to be the installer assignee.
      qb.andWhere('job.managerId = :viewerId', { viewerId: viewer.userId });
    }

    const rows = await qb
      .orderBy('a.scheduledDate', 'ASC')
      .addOrderBy('a.slot', 'ASC')
      .addOrderBy('a.staffUserId', 'ASC')
      .getMany();

    const items: ScheduleItemDto[] = rows.map((a) => ({
      assignmentId: a.id,
      jobId: a.jobId,
      customerId: a.job.customerId,
      systemSizeKw: Number(a.job.systemSizeKw),
      staffUserId: a.staffUserId,
      staffName:
        `${a.staffUser?.firstName ?? ''} ${a.staffUser?.lastName ?? ''}`.trim(),
      scheduledDate: a.scheduledDate,
      slot: a.slot,
      locked: a.locked,
    }));

    const dailyMap = new Map<string, ScheduleDailyInstallerDto>();
    for (const it of items) {
      const key = `${it.scheduledDate}|${it.staffUserId}`;
      const cur = dailyMap.get(key);
      if (cur) {
        cur.bookedKw += it.systemSizeKw;
        cur.assignmentCount += 1;
      } else {
        dailyMap.set(key, {
          scheduledDate: it.scheduledDate,
          staffUserId: it.staffUserId,
          staffName: it.staffName,
          assignmentCount: 1,
          bookedKw: it.systemSizeKw,
        });
      }
    }

    const dailyLoadByInstaller = [...dailyMap.values()].sort((x, y) => {
      const d = x.scheduledDate.localeCompare(y.scheduledDate);
      if (d !== 0) return d;
      return x.staffName.localeCompare(y.staffName);
    });

    return {
      from,
      to,
      items,
      dailyLoadByInstaller,
    };
  }

  private static parseYmdUtc(s: string): Date {
    const [y, m, d] = s.split('-').map((x) => Number(x));
    if (!y || !m || !d) return new Date(NaN);
    return new Date(Date.UTC(y, m - 1, d));
  }
}
