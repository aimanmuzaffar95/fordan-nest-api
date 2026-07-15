import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { COMPLIANCE_UPLOAD_KIND } from '../files/upload.constants';
import { FilesService } from '../files/files.service';
import { Job } from '../jobs/entities/job.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { UserRole } from '../users/entities/user-role.enum';
import type { CreateDocumentSignRequestDto } from './dto/create-document-sign-request.dto';
import type { GenerateJobDocumentDto } from './dto/generate-job-document.dto';
import {
  JobDocumentSignRequest,
  type JobDocumentSignRequestStatus,
} from './entities/job-document-sign-request.entity';
import {
  JobGeneratedDocument,
  type JobGeneratedDocumentStatus,
} from './entities/job-generated-document.entity';
import {
  JOB_DOCUMENT_TEMPLATE_CATALOG,
  resolveJobDocumentTemplateTitle,
} from './job-document-template-catalog';
import { JobDocumentsPdfService } from './job-documents-pdf.service';

export type JobDocumentsViewer = { userId: string; role: UserRole };

@Injectable()
export class JobDocumentsService {
  constructor(
    @InjectRepository(JobGeneratedDocument)
    private readonly documentsRepo: Repository<JobGeneratedDocument>,
    @InjectRepository(JobDocumentSignRequest)
    private readonly signRequestsRepo: Repository<JobDocumentSignRequest>,
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    private readonly pdfService: JobDocumentsPdfService,
    private readonly filesService: FilesService,
    private readonly dataSource: DataSource,
  ) {}

  async listForJob(
    jobId: string,
    viewer: JobDocumentsViewer,
  ): Promise<{
    items: Array<{
      id: string;
      templateId: string;
      templateTitle: string;
      status: JobGeneratedDocumentStatus;
      fileId: string | null;
      downloadUrl: string | null;
      fields: Record<string, unknown> | null;
      createdAt: string;
      signRequests: Array<{
        id: string;
        mode: string;
        status: JobDocumentSignRequestStatus;
        recipientEmail: string | null;
        createdAt: string;
      }>;
    }>;
  }> {
    await this.assertJobAccess(jobId, viewer);

    const rows = await this.documentsRepo.find({
      where: { jobId },
      order: { createdAt: 'DESC' },
    });

    const documentIds = rows.map((row) => row.id);
    const signRows =
      documentIds.length === 0
        ? []
        : await this.signRequestsRepo.find({
            where: { jobId, documentId: In(documentIds) },
            order: { createdAt: 'DESC' },
          });

    const signByDocument = new Map<string, JobDocumentSignRequest[]>();
    for (const sign of signRows) {
      const bucket = signByDocument.get(sign.documentId) ?? [];
      bucket.push(sign);
      signByDocument.set(sign.documentId, bucket);
    }

    return {
      items: rows.map((row) => ({
        id: row.id,
        templateId: row.templateId,
        templateTitle: resolveJobDocumentTemplateTitle(row.templateId),
        status: row.status,
        fileId: row.fileId,
        downloadUrl: row.fileId
          ? `/api/jobs/${jobId}/files/${row.fileId}/download`
          : null,
        fields: row.fields,
        createdAt: row.createdAt.toISOString(),
        signRequests: (signByDocument.get(row.id) ?? []).map((sign) => ({
          id: sign.id,
          mode: sign.mode,
          status: sign.status,
          recipientEmail: sign.recipientEmail,
          createdAt: sign.createdAt.toISOString(),
        })),
      })),
    };
  }

  async generateForJob(
    jobId: string,
    dto: GenerateJobDocumentDto,
    viewer: JobDocumentsViewer,
  ): Promise<{
    documentId: string;
    status: JobGeneratedDocumentStatus;
    downloadUrl?: string;
  }> {
    const job = await this.getJobForMutation(jobId, viewer);

    if (!JOB_DOCUMENT_TEMPLATE_CATALOG[dto.templateId]) {
      throw new BadRequestException(
        `Unknown document template: ${dto.templateId}`,
      );
    }

    const customerName = job.customer
      ? `${job.customer.firstName ?? ''} ${job.customer.lastName ?? ''}`.trim()
      : null;

    const pdfBuffer = await this.pdfService.buildStubDocumentPdf({
      templateId: dto.templateId,
      jobId,
      orderNumber: job.orderNumber,
      customerName: customerName || null,
      fields: dto.fields ?? null,
    });

    const displayName = resolveJobDocumentTemplateTitle(dto.templateId);

    const savedFile = await this.filesService.persistJobGeneratedPdf({
      jobId,
      buffer: pdfBuffer,
      displayName,
      kind: COMPLIANCE_UPLOAD_KIND,
      contentType: 'application/pdf',
      uploadedByUserId: viewer.userId,
      timelineActorUserId: null,
    });

    const saved = await this.dataSource.transaction(async (manager) => {
      const documentsRepository = manager.getRepository(JobGeneratedDocument);
      const timelineRepository = manager.getRepository(TimelineEvent);

      const document = await documentsRepository.save(
        documentsRepository.create({
          jobId,
          templateId: dto.templateId,
          status: 'generated',
          fileId: savedFile.id,
          fields: dto.fields ?? null,
          createdByUserId: viewer.userId,
        }),
      );

      await timelineRepository.save(
        timelineRepository.create({
          jobId,
          type: 'document_generated',
          payload: {
            documentId: document.id,
            templateId: dto.templateId,
            templateTitle: displayName,
            fileId: savedFile.id,
          },
          createdByUserId: viewer.userId,
        }),
      );

      return document;
    });

    return {
      documentId: saved.id,
      status: saved.status,
      downloadUrl: `/api/jobs/${jobId}/files/${savedFile.id}/download`,
    };
  }

  async createSignRequest(
    jobId: string,
    documentId: string,
    dto: CreateDocumentSignRequestDto,
    viewer: JobDocumentsViewer,
  ): Promise<{ signRequestId: string; status: JobDocumentSignRequestStatus }> {
    await this.assertJobAccess(jobId, viewer);

    const document = await this.documentsRepo.findOne({
      where: { id: documentId, jobId },
    });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    if (!document.fileId) {
      throw new BadRequestException('Document has no generated PDF to sign');
    }

    const status: JobDocumentSignRequestStatus =
      dto.mode === 'email' ? 'pending' : 'pending';

    const saved = await this.dataSource.transaction(async (manager) => {
      const documentsRepository = manager.getRepository(JobGeneratedDocument);
      const signRepository = manager.getRepository(JobDocumentSignRequest);
      const timelineRepository = manager.getRepository(TimelineEvent);

      const signRequest = await signRepository.save(
        signRepository.create({
          jobId,
          documentId: document.id,
          mode: dto.mode,
          recipientEmail:
            dto.mode === 'email' ? (dto.recipientEmail?.trim() ?? null) : null,
          status,
          createdByUserId: viewer.userId,
        }),
      );

      await documentsRepository.update(document.id, { status: 'sign_pending' });

      await timelineRepository.save(
        timelineRepository.create({
          jobId,
          type: 'document_sign_requested',
          payload: {
            documentId: document.id,
            signRequestId: signRequest.id,
            templateId: document.templateId,
            mode: dto.mode,
            recipientEmail:
              dto.mode === 'email'
                ? (dto.recipientEmail?.trim() ?? null)
                : null,
          },
          createdByUserId: viewer.userId,
        }),
      );

      return signRequest;
    });

    // TODO(FU-82): integrate email / on-device e-sign provider when available.

    return {
      signRequestId: saved.id,
      status: saved.status,
    };
  }

  private async getJobForMutation(
    jobId: string,
    viewer: JobDocumentsViewer,
  ): Promise<Job> {
    await this.assertJobAccess(jobId, viewer);
    const job = await this.jobsRepo.findOne({
      where: { id: jobId },
      relations: { customer: true },
    });
    if (!job) {
      throw new NotFoundException('Job not found');
    }
    return job;
  }

  private async assertJobAccess(
    jobId: string,
    viewer: JobDocumentsViewer,
  ): Promise<void> {
    const job = await this.jobsRepo.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Job not found');
    }
    if (viewer.role === UserRole.ADMIN) {
      return;
    }
    if (viewer.role === UserRole.MANAGER) {
      if (job.managerId !== viewer.userId) {
        throw new NotFoundException('Job not found');
      }
      return;
    }
    if (viewer.role === UserRole.INSTALLER) {
      if (job.assignedStaffUserId === viewer.userId) {
        return;
      }
      const cnt = await this.assignmentsRepo.count({
        where: { jobId: job.id, staffUserId: viewer.userId },
      });
      if (cnt > 0) {
        return;
      }
      throw new NotFoundException('Job not found');
    }
    throw new NotFoundException('Job not found');
  }
}
