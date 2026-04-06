import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { MeterApplication } from './entities/meter-application.entity';
import type { MulterMemoryFile } from '../files/multer-memory-file.type';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { UpdateMeterApplicationDto } from './dto/update-meter-application.dto';
import { Job } from '../jobs/entities/job.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { JobsService } from '../jobs/jobs.service';
import { FilesService } from '../files/files.service';

export type MeterApplicationViewer = {
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
  submittedByUserId: string;
  rejectionReason: string | null;
};

@Injectable()
export class MeterApplicationsService {
  constructor(
    @InjectRepository(MeterApplication)
    private readonly meterRepo: Repository<MeterApplication>,
    @InjectRepository(TimelineEvent)
    private readonly timelineRepo: Repository<TimelineEvent>,
    private readonly jobsService: JobsService,
    private readonly filesService: FilesService,
  ) {}

  async list(
    viewer: MeterApplicationViewer,
  ): Promise<{ items: MeterApplicationListItem[] }> {
    const qb = this.meterRepo
      .createQueryBuilder('meterApplication')
      .select([
        'meterApplication.id AS id',
        'meterApplication.jobId AS "jobId"',
        'meterApplication.type AS type',
        'meterApplication.status AS status',
        'meterApplication.dateSubmitted AS "dateSubmitted"',
        'meterApplication.approvalDate AS "approvalDate"',
        'meterApplication.submittedByUserId AS "submittedByUserId"',
        'meterApplication.rejectionReason AS "rejectionReason"',
      ])
      .orderBy('meterApplication.dateSubmitted', 'DESC')
      .addOrderBy('meterApplication.createdAt', 'DESC');

    this.applyAdminManagerListScope(qb, viewer);

    return {
      items: await qb.getRawMany<MeterApplicationListItem>(),
    };
  }

  /**
   * Admin / manager / installer: meter row visible when the parent job is visible
   * to that viewer (manager by `managerId`, installer by assignment rules).
   */
  private async assertMeterApplicationAccessible(
    id: string,
    viewer: MeterApplicationViewer,
  ): Promise<MeterApplication> {
    const row = await this.meterRepo.findOne({
      where: { id },
      relations: { job: true },
    });
    if (!row?.job) {
      throw new NotFoundException('Meter application not found');
    }

    if (viewer.role === UserRole.ADMIN) {
      return row;
    }

    await this.jobsService.loadJobWithViewerAccess(row.jobId, {
      userId: viewer.userId,
      role: viewer.role,
    });

    return row;
  }

  async listFiles(id: string, viewer: MeterApplicationViewer) {
    await this.assertMeterApplicationAccessible(id, viewer);
    return this.filesService.listForMeterApplication(id);
  }

  async uploadFile(
    id: string,
    file: MulterMemoryFile | undefined,
    viewer: MeterApplicationViewer,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Multipart field "file" is required');
    }

    await this.assertMeterApplicationAccessible(id, viewer);

    return this.filesService.saveMeterApplicationUpload({
      meterApplicationId: id,
      buffer: file.buffer,
      originalName: file.originalname ?? '',
      mimetype: file.mimetype ?? 'application/octet-stream',
      uploadedByUserId: viewer.userId,
    });
  }

  async updateStatus(
    id: string,
    dto: UpdateMeterApplicationDto,
    viewer: MeterApplicationViewer,
  ): Promise<MeterApplication> {
    if (viewer.role === UserRole.INSTALLER) {
      throw new ForbiddenException();
    }

    const row = await this.assertMeterApplicationAccessible(id, viewer);

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

  /** List endpoint: admin sees all; manager sees own jobs only (installers cannot list). */
  private applyAdminManagerListScope(
    qb: SelectQueryBuilder<MeterApplication>,
    viewer: MeterApplicationViewer,
  ) {
    if (viewer.role === UserRole.MANAGER) {
      qb.innerJoin(
        Job,
        'job_scope',
        'job_scope.id = meterApplication.jobId AND job_scope.managerId = :managerUserId',
        { managerUserId: viewer.userId },
      );
    }
  }
}
