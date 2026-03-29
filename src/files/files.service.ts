import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Readable } from 'node:stream';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { UploadJobFileDto } from '../jobs/dto/upload-job-file.dto';
import { Job } from '../jobs/entities/job.entity';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { UploadOwnedFileDto } from './dto/upload-owned-file.dto';
import { File as FileEntity } from './entities/file.entity';
import { FilesStorageService } from './files-storage.service';
import {
  DEFAULT_METER_APPLICATION_UPLOAD_KIND,
  UploadKind,
} from './upload.constants';
import { UploadedBinaryFile } from './uploaded-binary-file.type';

type AuthenticatedViewer = {
  userId: string;
  role: UserRole;
};

export type OwnedFileItem = {
  id: string;
  ownerType: string;
  ownerId: string;
  kind: string;
  storageDriver: string;
  displayName: string | null;
  originalName: string | null;
  contentType: string | null;
  sizeBytes: string | null;
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  createdAt: string;
  downloadPath: string;
};

type DownloadableFile = {
  file: FileEntity;
  stream: Readable;
  contentLength?: number;
};

@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepo: Repository<FileEntity>,
    @InjectRepository(MeterApplication)
    private readonly meterApplicationRepo: Repository<MeterApplication>,
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly storageService: FilesStorageService,
  ) {}

  get maxUploadSizeBytes(): number {
    return this.storageService.maxUploadSizeBytes;
  }

  async listMeterApplicationFiles(
    meterApplicationId: string,
    viewer: AuthenticatedViewer,
  ): Promise<{ items: OwnedFileItem[] }> {
    await this.getScopedMeterApplicationOrFail(meterApplicationId, viewer);

    const rows = await this.fileRepo.find({
      where: {
        ownerType: 'meter_application',
        ownerId: meterApplicationId,
      },
      relations: {
        uploadedByUser: true,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    return {
      items: rows.map((row) => this.toOwnedFileItem(row)),
    };
  }

  async uploadMeterApplicationFile(
    meterApplicationId: string,
    dto: UploadOwnedFileDto,
    uploadedFile: UploadedBinaryFile | undefined,
    viewer: AuthenticatedViewer,
  ): Promise<OwnedFileItem> {
    const meterApplication = await this.getScopedMeterApplicationOrFail(
      meterApplicationId,
      viewer,
    );

    const file = this.validateIncomingFile(uploadedFile);
    const stored = await this.storageService.store({
      ownerType: 'meter_application',
      ownerId: meterApplicationId,
      kind: (dto.kind ?? DEFAULT_METER_APPLICATION_UPLOAD_KIND) as UploadKind,
      originalName: file.originalname,
      contentType: file.mimetype,
      buffer: file.buffer,
    });

    const savedUpload = await this.dataSource.transaction(async (manager) => {
      const fileRepository = manager.getRepository(FileEntity);
      const timelineRepository = manager.getRepository(TimelineEvent);
      const usersRepository = manager.getRepository(User);
      const uploadedByUser = await usersRepository.findOne({
        where: { id: viewer.userId },
        select: ['id', 'firstName', 'lastName'],
      });

      const savedFile = await fileRepository.save(
        fileRepository.create({
          ownerType: 'meter_application',
          ownerId: meterApplicationId,
          kind: (dto.kind ??
            DEFAULT_METER_APPLICATION_UPLOAD_KIND) as UploadKind,
          storageDriver: stored.storageDriver,
          storageBucket: stored.storageBucket,
          storageKey: stored.storageKey,
          originalName: file.originalname,
          contentType: file.mimetype,
          sizeBytes: String(file.size),
          uploadedByUserId: viewer.userId,
        }),
      );

      await timelineRepository.save(
        timelineRepository.create({
          jobId: meterApplication.jobId,
          type: 'meter_file_uploaded',
          payload: {
            meterApplicationId: meterApplication.id,
            meterType: meterApplication.type,
            fileId: savedFile.id,
            kind: savedFile.kind,
            originalName: savedFile.originalName,
            contentType: savedFile.contentType,
            sizeBytes: savedFile.sizeBytes,
          },
          createdByUserId: viewer.userId,
        }),
      );

      return {
        savedFile,
        uploadedByUser,
      };
    });

    return this.toOwnedFileItem(
      savedUpload.savedFile,
      savedUpload.uploadedByUser,
    );
  }

  async listJobFiles(
    jobId: string,
    viewer: AuthenticatedViewer,
  ): Promise<{ items: OwnedFileItem[] }> {
    await this.getScopedJobOrFail(jobId, viewer);

    const rows = await this.fileRepo.find({
      where: {
        ownerType: 'job',
        ownerId: jobId,
      },
      relations: {
        uploadedByUser: true,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    return {
      items: rows.map((row) => this.toOwnedFileItem(row)),
    };
  }

  async uploadJobFile(
    jobId: string,
    dto: UploadJobFileDto,
    uploadedFile: UploadedBinaryFile | undefined,
    viewer: AuthenticatedViewer,
  ): Promise<OwnedFileItem> {
    const job = await this.getScopedJobOrFail(jobId, viewer);
    const file = this.validateIncomingFile(uploadedFile);
    const displayName = dto.displayName.trim();
    if (!displayName) {
      throw new BadRequestException('displayName is required');
    }
    const stored = await this.storageService.store({
      ownerType: 'job',
      ownerId: jobId,
      kind: (dto.kind ?? 'other') as UploadKind,
      originalName: file.originalname,
      contentType: file.mimetype,
      buffer: file.buffer,
    });

    const savedUpload = await this.dataSource.transaction(async (manager) => {
      const fileRepository = manager.getRepository(FileEntity);
      const timelineRepository = manager.getRepository(TimelineEvent);
      const usersRepository = manager.getRepository(User);
      const uploadedByUser = await usersRepository.findOne({
        where: { id: viewer.userId },
        select: ['id', 'firstName', 'lastName'],
      });

      const savedFile = await fileRepository.save(
        fileRepository.create({
          ownerType: 'job',
          ownerId: jobId,
          kind: (dto.kind ?? 'other') as UploadKind,
          storageDriver: stored.storageDriver,
          storageBucket: stored.storageBucket,
          storageKey: stored.storageKey,
          originalName: null,
          displayName,
          contentType: file.mimetype,
          sizeBytes: String(file.size),
          uploadedByUserId: viewer.userId,
        }),
      );

      await timelineRepository.save(
        timelineRepository.create({
          jobId: job.id,
          type: 'job_file_uploaded',
          payload: {
            fileId: savedFile.id,
            kind: savedFile.kind,
            displayName: savedFile.displayName,
            contentType: savedFile.contentType,
            sizeBytes: savedFile.sizeBytes,
          },
          createdByUserId: viewer.userId,
        }),
      );

      return {
        savedFile,
        uploadedByUser,
      };
    });

    return this.toOwnedFileItem(
      savedUpload.savedFile,
      savedUpload.uploadedByUser,
    );
  }

  async getJobFileDownload(
    jobId: string,
    fileId: string,
    viewer: AuthenticatedViewer,
  ): Promise<DownloadableFile> {
    await this.getScopedJobOrFail(jobId, viewer);

    const file = await this.fileRepo.findOne({
      where: {
        id: fileId,
        ownerType: 'job',
        ownerId: jobId,
      },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const storedFile = await this.storageService.getStoredFile(file);

    return {
      file,
      stream: storedFile.stream,
      contentLength: storedFile.contentLength,
    };
  }

  async getMeterApplicationFileDownload(
    meterApplicationId: string,
    fileId: string,
    viewer: AuthenticatedViewer,
  ): Promise<DownloadableFile> {
    await this.getScopedMeterApplicationOrFail(meterApplicationId, viewer);

    const file = await this.fileRepo.findOne({
      where: {
        id: fileId,
        ownerType: 'meter_application',
        ownerId: meterApplicationId,
      },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const storedFile = await this.storageService.getStoredFile(file);

    return {
      file,
      stream: storedFile.stream,
      contentLength: storedFile.contentLength,
    };
  }

  private validateIncomingFile(
    uploadedFile: UploadedBinaryFile | undefined,
  ): UploadedBinaryFile {
    if (!uploadedFile) {
      throw new BadRequestException('file is required');
    }

    return uploadedFile;
  }

  private async getScopedMeterApplicationOrFail(
    meterApplicationId: string,
    viewer: AuthenticatedViewer,
  ): Promise<MeterApplication> {
    const qb = this.meterApplicationRepo
      .createQueryBuilder('meterApplication')
      .where('meterApplication.id = :meterApplicationId', {
        meterApplicationId,
      });

    this.applyViewerScope(qb, viewer);

    const row = await qb.getOne();
    if (!row) {
      throw new NotFoundException('Meter application not found');
    }

    return row;
  }

  private async getScopedJobOrFail(
    jobId: string,
    viewer: AuthenticatedViewer,
  ): Promise<Job> {
    const job = await this.jobsRepo.findOne({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (viewer.role === UserRole.MANAGER) {
      this.assertManagerJobAccess(job, viewer.userId);
    }

    if (viewer.role === UserRole.INSTALLER) {
      await this.assertInstallerJobAccess(job, viewer.userId);
    }

    return job;
  }

  private applyViewerScope(
    qb: SelectQueryBuilder<MeterApplication>,
    viewer: AuthenticatedViewer,
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

  private async assertInstallerJobAccess(job: Job, userId: string) {
    if (job.assignedStaffUserId === userId) {
      return;
    }

    const user = await this.usersRepo.findOne({
      where: { id: userId },
      select: ['id', 'teamId'],
    });

    if (
      user?.teamId &&
      job.assignedTeamId &&
      job.assignedTeamId === user.teamId
    ) {
      return;
    }

    const accessConditions: Array<{
      jobId: string;
      staffUserId?: string;
      teamId?: string;
    }> = [{ jobId: job.id, staffUserId: userId }];

    if (user?.teamId) {
      accessConditions.push({ jobId: job.id, teamId: user.teamId });
    }

    const hasAssignmentAccess = await this.assignmentsRepo.count({
      where: accessConditions,
    });

    if (hasAssignmentAccess > 0) {
      return;
    }

    throw new NotFoundException('Job not found');
  }

  private assertManagerJobAccess(job: Job, userId: string) {
    if (job.managerId === userId) {
      return;
    }

    throw new NotFoundException('Job not found');
  }

  private safeTrim(value: string | null | undefined): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private toOwnedFileItem(
    row: FileEntity,
    uploadedByUserOverride?: Pick<User, 'firstName' | 'id' | 'lastName'> | null,
  ): OwnedFileItem {
    const uploadedByUser = uploadedByUserOverride ?? row.uploadedByUser;
    const uploaderFirstName = this.safeTrim(uploadedByUser?.firstName);
    const uploaderLastName = this.safeTrim(uploadedByUser?.lastName);
    const uploadedByName =
      `${uploaderFirstName} ${uploaderLastName}`.trim() || null;

    return {
      id: row.id,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      kind: row.kind,
      storageDriver: row.storageDriver,
      displayName: row.displayName,
      originalName: row.originalName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      uploadedByUserId: row.uploadedByUserId,
      uploadedByName,
      createdAt: row.createdAt.toISOString(),
      downloadPath: this.buildDownloadPath(row),
    };
  }

  private buildDownloadPath(row: FileEntity): string {
    if (row.ownerType === 'job') {
      return `/api/jobs/${row.ownerId}/files/${row.id}/download`;
    }

    return `/api/meter-applications/${row.ownerId}/files/${row.id}/download`;
  }
}
