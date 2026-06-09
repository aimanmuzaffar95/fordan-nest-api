import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThanOrEqual, Repository } from 'typeorm';
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

    await this.repo.delete({
      userId,
      startsAt: MoreThanOrEqual(effectiveFrom),
    });

    const saved = await this.repo.save(
      parsed.map((item) =>
        this.repo.create({
          userId,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          notes: item.notes,
          recurrenceRule: item.recurrenceRule,
          source: 'mobile',
        }),
      ),
    );

    return { items: saved.map((r) => this.toResponse(r)) };
  }

  async listTeam(filters: {
    userId?: string;
    teamId?: string;
    from?: string;
    to?: string;
  }): Promise<{ items: AvailabilityItemResponse[] }> {
    if (!filters.userId) {
      throw new NotFoundException('userId filter required for team availability');
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
