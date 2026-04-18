import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { MeterApplication } from './entities/meter-application.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { UpdateMeterApplicationDto } from './dto/update-meter-application.dto';
import { Job } from '../jobs/entities/job.entity';
import { UserRole } from '../users/entities/user-role.enum';

type MeterApplicationViewer = {
  userId: string;
  role: UserRole;
};

export type MeterApplicationListItem = {
  id: string;
  jobId: string;
  type: string;
  status: string;
  dateSubmitted: string;
  approvalDate: string | null;
  approvedByName: string | null;
  submittedByUserId: string;
  submittedByName: string | null;
  rejectionReason: string | null;
};

type MeterApplicationListRow = MeterApplicationListItem & {
  approvedByFirstName: string | null;
  approvedByLastName: string | null;
  submittedByFirstName: string | null;
  submittedByLastName: string | null;
};

@Injectable()
export class MeterApplicationsService {
  constructor(
    @InjectRepository(MeterApplication)
    private readonly meterRepo: Repository<MeterApplication>,
    @InjectRepository(TimelineEvent)
    private readonly timelineRepo: Repository<TimelineEvent>,
  ) {}

  async list(
    viewer: MeterApplicationViewer,
  ): Promise<{ items: MeterApplicationListItem[] }> {
    const qb = this.meterRepo
      .createQueryBuilder('meterApplication')
      .leftJoin('meterApplication.submittedByUser', 'submittedByUser')
      .leftJoin('meterApplication.approvedByUser', 'approvedByUser')
      .select([
        'meterApplication.id AS id',
        'meterApplication.jobId AS "jobId"',
        'meterApplication.type AS type',
        'meterApplication.status AS status',
        'meterApplication.dateSubmitted AS "dateSubmitted"',
        'meterApplication.approvalDate AS "approvalDate"',
        'approvedByUser.firstName AS "approvedByFirstName"',
        'approvedByUser.lastName AS "approvedByLastName"',
        'meterApplication.submittedByUserId AS "submittedByUserId"',
        'submittedByUser.firstName AS "submittedByFirstName"',
        'submittedByUser.lastName AS "submittedByLastName"',
        'meterApplication.rejectionReason AS "rejectionReason"',
      ])
      .orderBy('meterApplication.dateSubmitted', 'DESC')
      .addOrderBy('meterApplication.createdAt', 'DESC');

    this.applyViewerScope(qb, viewer);

    const rows = await qb.getRawMany<MeterApplicationListRow>();

    return {
      items: rows.map((row) => ({
        id: row.id,
        jobId: row.jobId,
        type: row.type,
        status: row.status,
        dateSubmitted: row.dateSubmitted,
        approvalDate: row.approvalDate,
        approvedByName: this.buildUserFullName(
          row.approvedByFirstName,
          row.approvedByLastName,
        ),
        submittedByUserId: row.submittedByUserId,
        submittedByName: this.buildUserFullName(
          row.submittedByFirstName,
          row.submittedByLastName,
        ),
        rejectionReason: row.rejectionReason,
      })),
    };
  }

  async updateStatus(
    id: string,
    dto: UpdateMeterApplicationDto,
    viewer: MeterApplicationViewer,
  ): Promise<MeterApplication> {
    const qb = this.meterRepo
      .createQueryBuilder('meterApplication')
      .leftJoinAndSelect('meterApplication.job', 'job')
      .where('meterApplication.id = :id', { id });

    this.applyViewerScope(qb, viewer);

    const row = await qb.getOne();
    if (!row) {
      throw new NotFoundException('Meter application not found');
    }

    if (dto.status === 'rejected') {
      const reason = dto.rejectionReason?.trim();
      if (!reason) {
        throw new BadRequestException(
          'rejectionReason is required when status is rejected',
        );
      }
    }

    const previousStatus = row.status;
    const today = new Date().toISOString().slice(0, 10);

    row.status = dto.status;
    if (dto.status === 'approved') {
      row.approvalDate = today;
      row.approvedByUserId = viewer.userId;
      row.rejectedAt = null;
      row.rejectedByUserId = null;
      row.rejectionReason = null;
    } else if (dto.status === 'rejected') {
      row.rejectedAt = today;
      row.rejectedByUserId = viewer.userId;
      row.rejectionReason = dto.rejectionReason!.trim();
      row.approvalDate = null;
      row.approvedByUserId = null;
    } else {
      row.approvalDate = null;
      row.approvedByUserId = null;
      row.rejectedAt = null;
      row.rejectedByUserId = null;
      row.rejectionReason = null;
    }

    const saved = await this.meterRepo.save(row);

    await this.timelineRepo.save(
      this.timelineRepo.create({
        jobId: saved.jobId,
        type: 'meter_status_change',
        payload: {
          meterApplicationId: saved.id,
          meterType: saved.type,
          previousStatus,
          status: saved.status,
          rejectionReason: saved.rejectionReason,
        },
        createdByUserId: viewer.userId,
      }),
    );

    return saved;
  }

  private applyViewerScope(
    qb: SelectQueryBuilder<MeterApplication>,
    viewer: MeterApplicationViewer,
  ) {
    if (viewer.role !== UserRole.MANAGER) {
      return;
    }

    qb.innerJoin(
      Job,
      'job_scope',
      'job_scope.id = meterApplication.jobId AND job_scope.managerId = :managerUserId',
      { managerUserId: viewer.userId },
    );
  }

  private buildUserFullName(
    firstName: string | null | undefined,
    lastName: string | null | undefined,
  ) {
    const joined = [firstName ?? '', lastName ?? '']
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' ');

    return joined.length > 0 ? joined : null;
  }
}
