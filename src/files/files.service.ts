import {
  BadRequestException,
  ForbiddenException,
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
  CRM_BRANDING_FILE_KIND,
  CRM_BRANDING_FAVICON_MIME_TYPES,
  CRM_BRANDING_LOGO_MIME_TYPES,
  CRM_BRANDING_OWNER_ID,
  CRM_BRANDING_OWNER_TYPE,
  CrmBrandingUploadSlot,
} from './crm-branding.constants';
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

  /**
   * Store a server-generated PDF for a job (e.g. e-signed quotation) with optional timeline row.
   */
  async persistJobGeneratedPdf(args: {
    jobId: string;
    buffer: Buffer;
    displayName: string;
    kind: UploadKind;
    contentType: string;
    uploadedByUserId: string | null;
    timelineActorUserId: string | null;
  }): Promise<FileEntity> {
    const job = await this.jobsRepo.findOne({ where: { id: args.jobId } });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const stored = await this.storageService.store({
      ownerType: 'job',
      ownerId: args.jobId,
      kind: args.kind,
      originalName: `${args.displayName.replace(/[^a-zA-Z0-9._-]+/g, '_')}.pdf`,
      contentType: args.contentType,
      buffer: args.buffer,
    });

    const savedUpload = await this.dataSource.transaction(async (manager) => {
      const fileRepository = manager.getRepository(FileEntity);
      const timelineRepository = manager.getRepository(TimelineEvent);
      const usersRepository = manager.getRepository(User);

      const uploadedByUser = args.uploadedByUserId
        ? await usersRepository.findOne({
            where: { id: args.uploadedByUserId },
            select: ['id', 'firstName', 'lastName'],
          })
        : null;

      const savedFile = await fileRepository.save(
        fileRepository.create({
          ownerType: 'job',
          ownerId: args.jobId,
          kind: args.kind,
          storageDriver: stored.storageDriver,
          storageBucket: stored.storageBucket,
          storageKey: stored.storageKey,
          originalName: null,
          displayName: args.displayName,
          contentType: args.contentType,
          sizeBytes: String(args.buffer.length),
          uploadedByUserId: args.uploadedByUserId,
        }),
      );

      await timelineRepository.save(
        timelineRepository.create({
          jobId: args.jobId,
          type: 'job_file_uploaded',
          payload: {
            fileId: savedFile.id,
            kind: savedFile.kind,
            displayName: savedFile.displayName,
            contentType: savedFile.contentType,
            sizeBytes: savedFile.sizeBytes,
            source: 'esign_completion',
          },
          createdByUserId: args.timelineActorUserId,
        }),
      );

      return { savedFile, uploadedByUser };
    });

    return savedUpload.savedFile;
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

  /**
   * Stream a job-owned file when the caller has already authorized access (e.g. public e-sign token).
   * Returns **404** when the file is missing or its `kind` is not in `allowedKinds`.
   */
  async getJobFileStreamWithKindGate(params: {
    jobId: string;
    fileId: string;
    allowedKinds: readonly UploadKind[];
  }): Promise<DownloadableFile> {
    const file = await this.fileRepo.findOne({
      where: {
        id: params.fileId,
        ownerType: 'job',
        ownerId: params.jobId,
      },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (!params.allowedKinds.includes(file.kind as UploadKind)) {
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

  async uploadCrmBrandingAsset(
    slot: CrmBrandingUploadSlot,
    uploadedFile: UploadedBinaryFile | undefined,
    viewer: AuthenticatedViewer,
  ): Promise<{ publicPath: string }> {
    if (viewer.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only admins can upload CRM branding assets',
      );
    }

    const file = this.validateIncomingFile(uploadedFile);
    const mimes =
      slot === CrmBrandingUploadSlot.logo
        ? CRM_BRANDING_LOGO_MIME_TYPES
        : CRM_BRANDING_FAVICON_MIME_TYPES;
    const mime = file.mimetype.trim().toLowerCase();
    if (!(mimes as readonly string[]).includes(mime)) {
      throw new BadRequestException(
        `Unsupported type for ${slot}. Allowed: ${[...mimes].join(', ')}`,
      );
    }

    const kind = CRM_BRANDING_FILE_KIND[slot];
    const existing = await this.fileRepo.find({
      where: {
        ownerType: CRM_BRANDING_OWNER_TYPE,
        ownerId: CRM_BRANDING_OWNER_ID,
        kind,
      },
    });

    for (const row of existing) {
      await this.storageService.deleteStoredFile(row);
      await this.fileRepo.remove(row);
    }

    const stored = await this.storageService.store({
      ownerType: CRM_BRANDING_OWNER_TYPE,
      ownerId: CRM_BRANDING_OWNER_ID,
      kind: 'other' as UploadKind,
      originalName: file.originalname,
      contentType: file.mimetype,
      buffer: file.buffer,
    });

    await this.fileRepo.save(
      this.fileRepo.create({
        ownerType: CRM_BRANDING_OWNER_TYPE,
        ownerId: CRM_BRANDING_OWNER_ID,
        kind,
        storageDriver: stored.storageDriver,
        storageBucket: stored.storageBucket,
        storageKey: stored.storageKey,
        originalName: file.originalname,
        displayName:
          slot === CrmBrandingUploadSlot.logo ? 'CRM logo' : 'CRM favicon',
        contentType: file.mimetype,
        sizeBytes: String(file.size),
        uploadedByUserId: viewer.userId,
      }),
    );

    return { publicPath: `/public/crm-branding/${slot}` };
  }

  async getPublicCrmBrandingDownload(
    slot: CrmBrandingUploadSlot,
  ): Promise<DownloadableFile> {
    const kind = CRM_BRANDING_FILE_KIND[slot];
    const row = await this.fileRepo.findOne({
      where: {
        ownerType: CRM_BRANDING_OWNER_TYPE,
        ownerId: CRM_BRANDING_OWNER_ID,
        kind,
      },
      order: { createdAt: 'DESC' },
    });

    if (!row) {
      throw new NotFoundException('Branding asset not found');
    }

    const storedFile = await this.storageService.getStoredFile(row);

    return {
      file: row,
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

    const hasAssignmentAccess = await this.assignmentsRepo.count({
      where: { jobId: job.id, staffUserId: userId },
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
