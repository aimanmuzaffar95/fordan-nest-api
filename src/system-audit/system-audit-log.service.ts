import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListAuditLogQueryDto } from './dto/list-audit-log-query.dto';
import { SystemAuditLog } from './entities/system-audit-log.entity';

/** Escape LIKE wildcards so user input is matched literally as a prefix. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Start of the given calendar day (UTC) for a YYYY-MM-DD / ISO string. */
function startOfDayUtc(value: string): Date {
  const d = new Date(value);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** Exclusive upper bound: start of the day after the given day (UTC). */
function startOfNextDayUtc(value: string): Date {
  const d = new Date(value);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1),
  );
}

export type RecordSystemAuditInput = {
  action: string;
  actorUserId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AuditLogItemDto = {
  id: string;
  createdAt: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
};

export type AuditLogListResponseDto = {
  items: AuditLogItemDto[];
  total: number;
  page: number;
  pageSize: number;
};

@Injectable()
export class SystemAuditLogService {
  constructor(
    @InjectRepository(SystemAuditLog)
    private readonly repo: Repository<SystemAuditLog>,
  ) {}

  async record(input: RecordSystemAuditInput): Promise<SystemAuditLog> {
    const row = this.repo.create({
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ?? null,
    });
    return this.repo.save(row);
  }

  async listPaginated(
    query: ListAuditLogQueryDto,
  ): Promise<AuditLogListResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const skip = (page - 1) * pageSize;

    const qb = this.repo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.actorUser', 'actor')
      .orderBy('log.createdAt', 'DESC')
      .skip(skip)
      .take(pageSize);

    if (query.action) {
      qb.andWhere('log.action LIKE :actionPrefix', {
        actionPrefix: `${escapeLikePattern(query.action)}%`,
      });
    }
    if (query.userId) {
      qb.andWhere('log.actorUserId = :actorUserId', {
        actorUserId: query.userId,
      });
    }
    if (query.from) {
      qb.andWhere('log.createdAt >= :from', {
        from: startOfDayUtc(query.from),
      });
    }
    if (query.to) {
      qb.andWhere('log.createdAt < :to', {
        to: startOfNextDayUtc(query.to),
      });
    }

    const [rows, total] = await qb.getManyAndCount();

    const items: AuditLogItemDto[] = rows.map((log) => {
      const actor = log.actorUser;
      const actorName = actor
        ? `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || null
        : null;
      return {
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        action: log.action,
        actorUserId: log.actorUserId,
        actorName,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        metadata: log.metadata ?? null,
      };
    });

    return { items, total, page, pageSize };
  }
}
