import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { StaffAvailability } from './entities/staff-availability.entity';
import { StaffAvailabilitySource } from './staff-availability-source.enum';
import {
  ListAdminAvailabilityQueryDto,
  ListMyAvailabilityQueryDto,
} from './dto/list-availability-query.dto';
import { PutAvailabilityDto } from './dto/put-availability.dto';

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(StaffAvailability)
    private readonly availabilityRepo: Repository<StaffAvailability>,
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async listMine(userId: string, query: ListMyAvailabilityQueryDto) {
    const qb = this.availabilityRepo
      .createQueryBuilder('a')
      .where('a.userId = :userId', { userId })
      .orderBy('a.startsAt', 'ASC')
      .take(2000);

    if (query.from && query.to) {
      const rangeStart = new Date(`${query.from}T00:00:00.000Z`);
      const rangeEnd = new Date(`${query.to}T23:59:59.999Z`);
      qb.andWhere('a.startsAt <= :rangeEnd AND a.endsAt >= :rangeStart', {
        rangeStart,
        rangeEnd,
      });
    }

    const rows = await qb.getMany();
    return { items: rows.map((r) => this.toItem(r)) };
  }

  async putMine(userId: string, dto: PutAvailabilityDto) {
    const effective = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);

    const parsed = dto.items.map((item) => ({
      startsAt: new Date(item.startsAt),
      endsAt: new Date(item.endsAt),
      notes: item.notes?.trim() || null,
      recurrenceRule: item.recurrenceRule?.trim() || null,
    }));

    for (const p of parsed) {
      if (
        Number.isNaN(p.startsAt.getTime()) ||
        Number.isNaN(p.endsAt.getTime())
      ) {
        throw new BadRequestException('Invalid startsAt or endsAt');
      }
      if (p.endsAt <= p.startsAt) {
        throw new BadRequestException('endsAt must be after startsAt');
      }
      if (p.startsAt < effective) {
        throw new BadRequestException(
          'Each window must start on or after effectiveFrom',
        );
      }
    }

    const sorted = [...parsed].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startsAt < sorted[i - 1].endsAt) {
        throw new ConflictException({
          message: 'Availability windows must not overlap.',
          code: 'CONFLICT',
        });
      }
    }

    await this.availabilityRepo
      .createQueryBuilder()
      .delete()
      .where('userId = :userId AND endsAt > :effective', { userId, effective })
      .execute();

    const toSave = parsed.map((p) =>
      this.availabilityRepo.create({
        userId,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        notes: p.notes,
        recurrenceRule: p.recurrenceRule,
        source: StaffAvailabilitySource.MOBILE,
      }),
    );

    const saved = await this.availabilityRepo.save(toSave);
    return { items: saved.map((r) => this.toItem(r)) };
  }

  async listAdmin(
    viewerUserId: string,
    role: UserRole,
    query: ListAdminAvailabilityQueryDto,
  ) {
    const qb = this.availabilityRepo
      .createQueryBuilder('a')
      .orderBy('a.startsAt', 'ASC')
      .take(2000);

    if (role === UserRole.MANAGER) {
      const allowedUserIds =
        await this.resolveManagerStaffUserIds(viewerUserId);
      if (allowedUserIds.length === 0) {
        return { items: [] };
      }
      qb.andWhere('a.userId IN (:...allowedUserIds)', { allowedUserIds });
    }

    if (query.userId) {
      if (role === UserRole.MANAGER) {
        const allowed = await this.resolveManagerStaffUserIds(viewerUserId);
        if (!allowed.includes(query.userId)) {
          throw new ForbiddenException();
        }
      }
      qb.andWhere('a.userId = :qUserId', { qUserId: query.userId });
    }

    if (query.teamId) {
      const usersInTeam = await this.usersRepo.find({
        where: { teamId: query.teamId },
        select: ['id'],
      });
      const ids = usersInTeam.map((u) => u.id);
      if (ids.length === 0) {
        return { items: [] };
      }
      if (role === UserRole.MANAGER) {
        const allowed = await this.resolveManagerStaffUserIds(viewerUserId);
        const intersection = ids.filter((id) => allowed.includes(id));
        if (intersection.length === 0) {
          return { items: [] };
        }
        qb.andWhere('a.userId IN (:...teamUserIds)', {
          teamUserIds: intersection,
        });
      } else {
        qb.andWhere('a.userId IN (:...teamUserIds)', { teamUserIds: ids });
      }
    }

    if (query.from && query.to) {
      const rangeStart = new Date(`${query.from}T00:00:00.000Z`);
      const rangeEnd = new Date(`${query.to}T23:59:59.999Z`);
      qb.andWhere('a.startsAt <= :rangeEnd AND a.endsAt >= :rangeStart', {
        rangeStart,
        rangeEnd,
      });
    }

    const rows = await qb.getMany();
    return { items: rows.map((r) => this.toItem(r)) };
  }

  private async resolveManagerStaffUserIds(
    managerUserId: string,
  ): Promise<string[]> {
    const jobs = await this.jobsRepo.find({
      where: { managerId: managerUserId },
      select: ['assignedStaffUserId', 'assignedTeamId'],
    });
    const ids = new Set<string>();
    const teamIds = new Set<string>();
    for (const j of jobs) {
      if (j.assignedStaffUserId) {
        ids.add(j.assignedStaffUserId);
      }
      if (j.assignedTeamId) {
        teamIds.add(j.assignedTeamId);
      }
    }
    if (teamIds.size === 0) {
      return [...ids];
    }
    const teamUsers = await this.usersRepo.find({
      where: { teamId: In([...teamIds]) },
      select: ['id'],
    });
    for (const u of teamUsers) {
      ids.add(u.id);
    }
    return [...ids];
  }

  private toItem(row: StaffAvailability) {
    return {
      id: row.id,
      userId: row.userId,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      notes: row.notes,
      recurrenceRule: row.recurrenceRule,
      source: row.source,
    };
  }
}
