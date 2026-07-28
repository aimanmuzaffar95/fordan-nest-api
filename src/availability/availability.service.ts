import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { PutAvailabilityMeDto } from './dto/put-availability-me.dto';
import { StaffAvailability } from './entities/staff-availability.entity';

type AvailabilityItemResponse = {
  id: string;
  userId: string;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  recurrenceRule: string | null;
  source: string;
};

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(StaffAvailability)
    private readonly repo: Repository<StaffAvailability>,
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    private readonly dataSource: DataSource,
  ) {}

  async listMine(
    userId: string,
    from?: string,
    to?: string,
  ): Promise<{ items: AvailabilityItemResponse[] }> {
    const where = this.buildRangeWhere(userId, from, to);
    const rows = await this.repo.find({
      where,
      order: { startsAt: 'ASC' },
    });
    return { items: rows.map((r) => this.toResponse(r)) };
  }

  async putMine(
    userId: string,
    dto: PutAvailabilityMeDto,
  ): Promise<{ items: AvailabilityItemResponse[] }> {
    const effectiveFrom = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
    const parsed = dto.items.map((item) => ({
      startsAt: new Date(item.startsAt),
      endsAt: new Date(item.endsAt),
      notes: item.notes ?? null,
      recurrenceRule: item.recurrenceRule ?? null,
    }));

    for (const item of parsed) {
      if (item.endsAt <= item.startsAt) {
        throw new ConflictException('Availability end must be after start');
      }
    }

    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        if (this.overlaps(parsed[i], parsed[j])) {
          throw new ConflictException('Availability items overlap');
        }
      }
    }

    // Replace-from-effectiveFrom must be atomic: a delete that is not followed by
    // a successful insert would wipe the user's future availability (data loss).
    const saved = await this.dataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(StaffAvailability);
      await txRepo.delete({
        userId,
        startsAt: MoreThanOrEqual(effectiveFrom),
      });
      return txRepo.save(
        parsed.map((item) =>
          txRepo.create({
            userId,
            startsAt: item.startsAt,
            endsAt: item.endsAt,
            notes: item.notes,
            recurrenceRule: item.recurrenceRule,
            source: 'mobile',
          }),
        ),
      );
    });

    return { items: saved.map((r) => this.toResponse(r)) };
  }

  async listTeam(
    requester: { userId: string; role: UserRole },
    filters: {
      userId?: string;
      teamId?: string;
      from?: string;
      to?: string;
    },
  ): Promise<{ items: AvailabilityItemResponse[] }> {
    if (!filters.userId) {
      throw new NotFoundException(
        'userId filter required for team availability',
      );
    }

    // Access scoping: admins may read any user's availability. A manager may only
    // read the availability of an installer who is on a job they manage — this is
    // the effective "team" scope in the current schema (teams were removed, so the
    // teamId param is retained for API compatibility but no longer backs a table).
    if (requester.role !== UserRole.ADMIN) {
      const managesTarget = await this.assignmentRepo
        .createQueryBuilder('a')
        .innerJoin('a.job', 'job')
        .where('job.managerId = :managerId', { managerId: requester.userId })
        .andWhere('a.staffUserId = :targetId', { targetId: filters.userId })
        .getCount();
      if (managesTarget === 0) {
        throw new ForbiddenException(
          'You may only view availability for installers on jobs you manage',
        );
      }
    }

    return this.listMine(filters.userId, filters.from, filters.to);
  }

  private buildRangeWhere(
    userId: string,
    from?: string,
    to?: string,
  ): Record<string, unknown> {
    if (from && to) {
      return {
        userId,
        startsAt: Between(
          new Date(`${from}T00:00:00.000Z`),
          new Date(`${to}T23:59:59.999Z`),
        ),
      };
    }
    return { userId };
  }

  private overlaps(
    a: { startsAt: Date; endsAt: Date },
    b: { startsAt: Date; endsAt: Date },
  ): boolean {
    return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
  }

  private toResponse(row: StaffAvailability): AvailabilityItemResponse {
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
