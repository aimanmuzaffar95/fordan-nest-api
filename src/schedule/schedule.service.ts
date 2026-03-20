import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { GetScheduleQueryDto } from './dto/get-schedule-query.dto';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';

export type ScheduleViewer = { userId: string; role: UserRole };

export type ScheduleItemDto = {
  assignmentId: string;
  jobId: string;
  customerId: string;
  systemSizeKw: number;
  teamId: string;
  teamName: string;
  teamDailyCapacityKw: number;
  staffUserId: string;
  scheduledDate: string;
  slot: string;
  locked: boolean;
};

export type ScheduleDailyTeamDto = {
  scheduledDate: string;
  teamId: string;
  teamName: string;
  bookedKw: number;
  capacityKw: number;
};

export type ScheduleResponseDto = {
  from: string;
  to: string;
  teamId: string | null;
  items: ScheduleItemDto[];
  dailyKwByTeam: ScheduleDailyTeamDto[];
};

const MAX_RANGE_DAYS = 366;

@Injectable()
export class ScheduleService {
  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly runtimeSettings: RuntimeSettingsService,
  ) {}

  async get(
    query: GetScheduleQueryDto,
    viewer: ScheduleViewer,
  ): Promise<ScheduleResponseDto> {
    const calendarScopeEnforced = this.runtimeSettings.getCalendarScopeEnforced();
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

    let filterTeamId = query.teamId ?? null;

    const qb = this.assignmentRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.job', 'job')
      .leftJoinAndSelect('a.team', 'team')
      .where('a.scheduledDate >= :from', { from })
      .andWhere('a.scheduledDate <= :to', { to });

    if (viewer.role === UserRole.INSTALLER && calendarScopeEnforced) {
      const user = await this.usersRepo.findOne({
        where: { id: viewer.userId },
        select: ['id', 'teamId'],
      });
      if (!user) {
        throw new ForbiddenException('User not found');
      }
      if (filterTeamId && user.teamId && filterTeamId !== user.teamId) {
        throw new ForbiddenException(
          'Cannot query schedule for a team you are not on',
        );
      }
      if (filterTeamId && !user.teamId) {
        throw new ForbiddenException(
          'teamId filter is not allowed for your account',
        );
      }

      qb.andWhere(
        new Brackets((sub) => {
          sub.where('a.staffUserId = :viewerId', { viewerId: viewer.userId });
          if (user.teamId) {
            sub.orWhere('a.teamId = :viewerTeamId', {
              viewerTeamId: user.teamId,
            });
          }
        }),
      );
    }

    if (viewer.role === UserRole.MANAGER && calendarScopeEnforced) {
      // "Assigned to them" for manager means assignments where they are the staff assignee.
      qb.andWhere('a.staffUserId = :viewerId', { viewerId: viewer.userId });
    }

    if (viewer.role !== UserRole.INSTALLER || !calendarScopeEnforced) {
      if (filterTeamId) {
        qb.andWhere('a.teamId = :teamId', { teamId: filterTeamId });
      }
    } else if (filterTeamId) {
      // calendarScopeEnforced installer path already validated the filterTeamId above.
      // Avoid duplicating a filter that might unintentionally narrow beyond the "team OR staff" rule.
    }

    const rows = await qb
      .orderBy('a.scheduledDate', 'ASC')
      .addOrderBy('a.slot', 'ASC')
      .addOrderBy('a.teamId', 'ASC')
      .getMany();

    const items: ScheduleItemDto[] = rows.map((a) => ({
      assignmentId: a.id,
      jobId: a.jobId,
      customerId: a.job.customerId,
      systemSizeKw: Number(a.job.systemSizeKw),
      teamId: a.teamId,
      teamName: a.team.name,
      teamDailyCapacityKw: Number(a.team.dailyCapacityKw),
      staffUserId: a.staffUserId,
      scheduledDate: a.scheduledDate,
      slot: a.slot,
      locked: a.locked,
    }));

    const dailyMap = new Map<string, ScheduleDailyTeamDto>();
    for (const it of items) {
      const key = `${it.scheduledDate}|${it.teamId}`;
      const cur = dailyMap.get(key);
      if (cur) {
        cur.bookedKw += it.systemSizeKw;
      } else {
        dailyMap.set(key, {
          scheduledDate: it.scheduledDate,
          teamId: it.teamId,
          teamName: it.teamName,
          bookedKw: it.systemSizeKw,
          capacityKw: it.teamDailyCapacityKw,
        });
      }
    }

    const dailyKwByTeam = [...dailyMap.values()].sort((x, y) => {
      const d = x.scheduledDate.localeCompare(y.scheduledDate);
      if (d !== 0) return d;
      return x.teamName.localeCompare(y.teamName);
    });

    return {
      from,
      to,
      teamId: filterTeamId,
      items,
      dailyKwByTeam,
    };
  }

  private static parseYmdUtc(s: string): Date {
    const [y, m, d] = s.split('-').map((x) => Number(x));
    if (!y || !m || !d) return new Date(NaN);
    return new Date(Date.UTC(y, m - 1, d));
  }
}
