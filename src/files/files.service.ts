import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { JobsService, JobListViewer } from '../jobs/jobs.service';
import { File as FileEntity } from './entities/file.entity';
import { FilesStorageService } from './files-storage.service';
import {
  allowedUploadMime,
  extensionForMime,
  maxUploadBytes,
  normalizeMime,
} from './upload-mime';
import {
  FILE_KIND_METER_DOCS,
  FILE_OWNER_METER_APPLICATION,
} from './file-owner.constants';

export type FileSummaryDto = {
  id: string;
  ownerType: string;
  ownerId: string;
  kind: string;
  originalName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(FileEntity)
    private readonly filesRepo: Repository<FileEntity>,
    @InjectRepository(MeterApplication)
    private readonly meterRepo: Repository<MeterApplication>,
    private readonly storage: FilesStorageService,
    private readonly jobsService: JobsService,
  ) {}

  toSummary(file: FileEntity): FileSummaryDto {
    return {
      id: file.id,
      ownerType: file.ownerType,
      ownerId: file.ownerId,
      kind: file.kind,
      originalName: file.originalName,
      contentType: file.contentType,
      sizeBytes:
        file.sizeBytes != null && file.sizeBytes !== ''
          ? Number(file.sizeBytes)
          : null,
      createdAt: file.createdAt.toISOString(),
    };
  }

  async listForMeterApplication(meterApplicationId: string) {
    const rows = await this.filesRepo.find({
      where: {
        ownerType: FILE_OWNER_METER_APPLICATION,
        ownerId: meterApplicationId,
      },
      order: { createdAt: 'DESC' },
    });
    return { items: rows.map((r) => this.toSummary(r)) };
  }

  async saveMeterApplicationUpload(params: {
    meterApplicationId: string;
    buffer: Buffer;
    originalName: string;
    mimetype: string;
    uploadedByUserId: string;
  }): Promise<FileSummaryDto> {
    const maxBytes = maxUploadBytes();
    if (params.buffer.length > maxBytes) {
      throw new BadRequestException(
        `File exceeds maximum size of ${maxBytes} bytes`,
      );
    }
    const mime = allowedUploadMime(params.mimetype);
    if (!mime) {
      throw new BadRequestException(
        'Unsupported content type. Allowed: PDF, JPEG, PNG, WebP.',
      );
    }

    if (!this.storage.isLocalDriver()) {
      throw new BadRequestException(
        'Only local storage is supported for uploads today.',
      );
    }

    const id = randomUUID();
    const ext = extensionForMime(mime);
    const storageKey = `meter_application/${params.meterApplicationId}/${id}${ext}`;

    await this.storage.writeBuffer(storageKey, params.buffer);

    const original =
      params.originalName?.trim().slice(0, 255) || `upload${ext}`;

    const row = this.filesRepo.create({
      id,
      ownerType: FILE_OWNER_METER_APPLICATION,
      ownerId: params.meterApplicationId,
      kind: FILE_KIND_METER_DOCS,
      storageDriver: 'local',
      storageKey,
      originalName: original,
      contentType: normalizeMime(params.mimetype).slice(0, 100),
      sizeBytes: String(params.buffer.length),
      uploadedByUserId: params.uploadedByUserId,
    });
    const saved = await this.filesRepo.save(row);
    return this.toSummary(saved);
  }

  async openDownloadStream(fileId: string, viewer: JobListViewer) {
    const file = await this.filesRepo.findOne({ where: { id: fileId } });
    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.ownerType === FILE_OWNER_METER_APPLICATION) {
      const meter = await this.meterRepo.findOne({
        where: { id: file.ownerId },
      });
      if (!meter) {
        throw new NotFoundException('File not found');
      }
      await this.jobsService.loadJobWithViewerAccess(meter.jobId, viewer);
    } else {
      throw new NotFoundException('File not found');
    }

    if (file.storageDriver !== 'local') {
      throw new BadRequestException(
        'Download for this storage driver is not supported yet.',
      );
    }

    if (!this.storage.fileExistsOnDisk(file.storageKey)) {
      throw new NotFoundException('File content is no longer available');
    }

    const stream = this.storage.createReadStream(file.storageKey);
    const filename = file.originalName ?? `${file.id}`;
    return {
      stream,
      contentType: file.contentType ?? 'application/octet-stream',
      filename,
    };
  }
}
