import { Injectable } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { JobAuditAction } from './enums/job-audit-action.enum';
import { JobAuditLog } from './entities/job-audit-log.entity';
import { JobAuditValue } from './types/job-audit-value.type';

export type LogJobEventInput = {
  jobId: string;
  performedById?: string | null;
  action: JobAuditAction;
  field?: string | null;
  oldValue?: JobAuditValue | null;
  newValue?: JobAuditValue | null;
  metadata?: Record<string, JobAuditValue> | null;
};

@Injectable()
export class JobAuditLogsService {
  constructor(
    @InjectRepository(JobAuditLog)
    private readonly auditLogsRepo: Repository<JobAuditLog>,
  ) {}

  async logWithManager(
    manager: EntityManager,
    input: LogJobEventInput,
  ): Promise<JobAuditLog> {
    const repo = manager.getRepository(JobAuditLog);
    const log = repo.create({
      jobId: input.jobId,
      performedById: input.performedById ?? null,
      action: input.action,
      field: input.field ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      metadata: input.metadata ?? null,
    });

    return repo.save(log);
  }

  create(input: LogJobEventInput): JobAuditLog {
    return this.auditLogsRepo.create({
      jobId: input.jobId,
      performedById: input.performedById ?? null,
      action: input.action,
      field: input.field ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      metadata: input.metadata ?? null,
    });
  }
}
