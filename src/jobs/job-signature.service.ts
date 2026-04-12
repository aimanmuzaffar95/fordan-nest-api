import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { EmailService } from '../email/email.service';
import { FilesService } from '../files/files.service';
import type { UploadKind } from '../files/upload.constants';
import { UserRole } from '../users/entities/user-role.enum';
import type { JobListViewer } from './jobs.service';
import { JobsService } from './jobs.service';
import { JobQuotationService } from './job-quotation.service';
import { JobSignaturePdfMergeService } from './job-signature-pdf-merge.service';
import {
  JobSignatureRequest,
  type JobSignatureRequestStatus,
} from './entities/job-signature-request.entity';
import { Job } from './entities/job.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import type { CompletePublicSignatureDto } from './dto/complete-public-signature.dto';

export const ESIGN_CONSENT_VERSION = '1';

const SIGNED_FILE_KIND = 'signed_paperwork' as UploadKind;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function randomToken(): string {
  return randomBytes(32).toString('hex');
}

function referenceCode(): string {
  return `SIG-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function parsePngBase64(raw: string): Buffer {
  const trimmed = raw.trim();
  const b64 = trimmed.includes(',')
    ? (trimmed.split(',', 2)[1] ?? '')
    : trimmed;
  if (!b64) {
    throw new BadRequestException('signaturePngBase64 is empty');
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    throw new BadRequestException('signaturePngBase64 is not valid base64');
  }
  if (buf.length < 32 || buf.length > 600000) {
    throw new BadRequestException('Signature image is missing or too large');
  }
  const sig = buf.subarray(0, 8);
  if (
    sig[0] !== 0x89 ||
    sig[1] !== 0x50 ||
    sig[2] !== 0x4e ||
    sig[3] !== 0x47
  ) {
    throw new BadRequestException('Signature must be a PNG image');
  }
  return buf;
}

function publicBaseUrl(): string {
  const raw = process.env.ESIGN_PUBLIC_BASE_URL?.trim() ?? '';
  if (!raw) {
    throw new BadRequestException({
      message:
        'ESIGN_PUBLIC_BASE_URL is not configured. Set it to the web origin where customers open signing links (e.g. https://crm.example.com).',
      code: 'ESIGN_PUBLIC_BASE_URL_MISSING',
    });
  }
  return raw.replace(/\/+$/, '');
}

function tokenTtlMs(): number {
  const days = Number(process.env.ESIGN_TOKEN_TTL_DAYS ?? '14');
  const safe = Number.isFinite(days) && days > 0 && days <= 90 ? days : 14;
  return safe * 86400000;
}

@Injectable()
export class JobSignatureService {
  constructor(
    @InjectRepository(JobSignatureRequest)
    private readonly signatureRepo: Repository<JobSignatureRequest>,
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    @InjectRepository(TimelineEvent)
    private readonly timelineRepo: Repository<TimelineEvent>,
    private readonly jobs: JobsService,
    private readonly jobQuotation: JobQuotationService,
    private readonly pdfMerge: JobSignaturePdfMergeService,
    private readonly files: FilesService,
    private readonly email: EmailService,
  ) {}

  private assertStaff(viewer: JobListViewer): void {
    if (viewer.role === UserRole.INSTALLER) {
      throw new BadRequestException(
        'Installers cannot create signature requests',
      );
    }
  }

  private async expireIfNeeded(row: JobSignatureRequest): Promise<void> {
    if (row.status === 'signed' || row.status === 'cancelled') {
      return;
    }
    if (new Date() > row.expiresAt) {
      if (row.status !== 'expired') {
        row.status = 'expired';
        await this.signatureRepo.save(row);
      }
    }
  }

  async listForJob(jobId: string, viewer: JobListViewer) {
    this.assertStaff(viewer);
    await this.jobs.getOne(jobId, viewer);
    const items = await this.signatureRepo.find({
      where: { jobId },
      order: { createdAt: 'DESC' },
      take: 25,
    });
    return {
      items: items.map((r) => ({
        id: r.id,
        status: r.status,
        referenceCode: r.referenceCode,
        expiresAt: r.expiresAt.toISOString(),
        sentAt: r.sentAt?.toISOString() ?? null,
        viewedAt: r.viewedAt?.toISOString() ?? null,
        signedAt: r.signedAt?.toISOString() ?? null,
        signerEmail: r.signerEmail,
        signedFileId: r.signedFileId,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async createRequest(
    jobId: string,
    viewer: JobListViewer,
    sendEmail: boolean,
  ): Promise<{
    id: string;
    signingUrl: string;
    referenceCode: string;
    expiresAt: string;
  }> {
    this.assertStaff(viewer);
    const ctx = await this.jobQuotation.validateQuotationPrerequisites(
      jobId,
      viewer,
    );
    const base = publicBaseUrl();
    const rawToken = randomToken();
    const tokenHash = sha256Hex(rawToken);
    const ref = await this.uniqueReferenceCode();
    const expiresAt = new Date(Date.now() + tokenTtlMs());
    await this.cancelOpenRequests(jobId);
    const row = this.signatureRepo.create({
      jobId,
      status: 'pending' as JobSignatureRequestStatus,
      tokenHash,
      referenceCode: ref,
      expiresAt,
      sentAt: null,
      viewedAt: null,
      signedAt: null,
      signerEmail: ctx.customerEmail,
      signerName: ctx.customerName,
      signedFileId: null,
      auditPayload: null,
      createdByUserId: viewer.userId,
    });
    const saved = await this.signatureRepo.save(row);
    const signingUrl = `${base}/sign/${rawToken}`;
    if (sendEmail) {
      try {
        await this.email.send({
          to: ctx.customerEmail,
          subject: `Sign your Fordan Solar quotation — ${ctx.orderNumber}`,
          template: 'signature-request',
          context: {
            customerName: ctx.customerName,
            orderNumber: ctx.orderNumber,
            signingUrl,
            referenceCode: ref,
            currentYear: new Date().getFullYear(),
          },
        });
      } catch {
        await this.signatureRepo.update(
          { id: saved.id },
          { status: 'cancelled' },
        );
        throw new ServiceUnavailableException({
          message:
            'Email delivery failed. Signature request was not activated.',
          code: 'EMAIL_DELIVERY_FAILED',
        });
      }
    }
    const sentAt = new Date();
    saved.sentAt = sentAt;
    await this.signatureRepo.save(saved);
    await this.timelineRepo.save(
      this.timelineRepo.create({
        jobId,
        type: 'signature_request_sent',
        payload: {
          signatureRequestId: saved.id,
          referenceCode: ref,
          recipientEmail: ctx.customerEmail,
          sendChannel: sendEmail ? 'email' : 'link_only',
          sentAt: sentAt.toISOString(),
        },
        createdByUserId: viewer.userId,
      }),
    );
    return {
      id: saved.id,
      signingUrl,
      referenceCode: ref,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async uniqueReferenceCode(): Promise<string> {
    for (let i = 0; i < 8; i += 1) {
      const ref = referenceCode();
      const cnt = await this.signatureRepo.count({
        where: { referenceCode: ref },
      });
      if (cnt === 0) return ref;
    }
    return `SIG-${randomBytes(6).toString('hex').toUpperCase()}`;
  }

  private async cancelOpenRequests(jobId: string): Promise<void> {
    await this.signatureRepo.update(
      { jobId, status: 'pending' as JobSignatureRequestStatus },
      { status: 'cancelled' },
    );
    await this.signatureRepo.update(
      { jobId, status: 'viewed' as JobSignatureRequestStatus },
      { status: 'cancelled' },
    );
  }

  async getPublicSession(rawToken: string) {
    const token = rawToken?.trim();
    if (!token || token.length < 16) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    const tokenHash = sha256Hex(token);
    const row = await this.signatureRepo.findOne({ where: { tokenHash } });
    if (!row) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    await this.expireIfNeeded(row);
    if (row.status === 'expired' || row.status === 'cancelled') {
      throw new NotFoundException('Invalid or expired signing link');
    }
    if (row.status === 'signed') {
      throw new BadRequestException({
        message: 'This document has already been signed.',
        code: 'ALREADY_SIGNED',
      });
    }
    const jobFull = await this.jobsRepo.findOne({
      where: { id: row.jobId },
      relations: { customer: true },
    });
    if (!jobFull) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    const firstName = jobFull.customer?.firstName?.trim() || 'Customer';
    return {
      orderNumber: jobFull.orderNumber,
      customerFirstName: firstName,
      referenceCode: row.referenceCode,
      expiresAt: row.expiresAt.toISOString(),
      consentVersion: ESIGN_CONSENT_VERSION,
    };
  }

  async recordPublicView(rawToken: string): Promise<{ ok: true }> {
    const token = rawToken?.trim();
    if (!token || token.length < 16) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    const tokenHash = sha256Hex(token);
    const row = await this.signatureRepo.findOne({ where: { tokenHash } });
    if (!row) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    await this.expireIfNeeded(row);
    if (row.status !== 'pending' && row.status !== 'viewed') {
      throw new NotFoundException('Invalid or expired signing link');
    }
    if (row.status === 'pending') {
      row.status = 'viewed';
      row.viewedAt = new Date();
      await this.signatureRepo.save(row);
      await this.timelineRepo.save(
        this.timelineRepo.create({
          jobId: row.jobId,
          type: 'signature_link_viewed',
          payload: {
            signatureRequestId: row.id,
            referenceCode: row.referenceCode,
            viewedAt: row.viewedAt.toISOString(),
          },
          createdByUserId: null,
        }),
      );
    }
    return { ok: true };
  }

  async completePublicSign(
    rawToken: string,
    dto: CompletePublicSignatureDto,
    req: Request,
  ): Promise<{ ok: true; referenceCode: string }> {
    if (!dto.consentAccepted) {
      throw new BadRequestException('Consent is required to sign');
    }
    if (dto.consentVersion !== ESIGN_CONSENT_VERSION) {
      throw new BadRequestException(
        'Consent version mismatch; refresh the page',
      );
    }
    const token = rawToken?.trim();
    if (!token || token.length < 16) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    const tokenHash = sha256Hex(token);
    const row = await this.signatureRepo.findOne({ where: { tokenHash } });
    if (!row) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    await this.expireIfNeeded(row);
    if (row.status === 'expired' || row.status === 'cancelled') {
      throw new NotFoundException('Invalid or expired signing link');
    }
    if (row.status === 'signed') {
      throw new BadRequestException({
        message: 'This document has already been signed.',
        code: 'ALREADY_SIGNED',
      });
    }
    const png = parsePngBase64(dto.signaturePngBase64);
    const { pdfBuffer, attachmentFilename, orderNumber, customerName } =
      await this.jobQuotation.buildValidatedQuotationPdf(row.jobId, undefined);
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : req.ip || req.socket.remoteAddress || 'unknown';
    const signedAtIso = new Date().toISOString();
    const certLines = [
      'Electronic signature certificate (Fordan Solar CRM)',
      `Reference: ${row.referenceCode}`,
      `Order: ${orderNumber}`,
      `Signer: ${customerName}`,
      `Email: ${row.signerEmail}`,
      `Signed at (server UTC): ${signedAtIso}`,
      `IP address: ${ip}`,
    ];
    if (dto.geoLatitude != null && dto.geoLongitude != null) {
      certLines.push(
        `Client-reported location: ${dto.geoLatitude}, ${dto.geoLongitude}`,
      );
    }
    certLines.push(
      `Consent version: ${ESIGN_CONSENT_VERSION}`,
      'This page was generated when the customer submitted an electronic signature.',
    );
    const merged = await this.pdfMerge.mergeSignatureAndCertificate(
      pdfBuffer,
      png,
      certLines,
    );
    const displayName = `Signed quotation ${orderNumber}`;
    const auditPayload: Record<string, unknown> = {
      ip,
      userAgent:
        typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent']
          : null,
      signedAt: signedAtIso,
      referenceCode: row.referenceCode,
      consentVersion: ESIGN_CONSENT_VERSION,
    };
    if (dto.geoLatitude != null && dto.geoLongitude != null) {
      auditPayload.geoLatitude = dto.geoLatitude;
      auditPayload.geoLongitude = dto.geoLongitude;
    }
    const savedFile = await this.files.persistJobGeneratedPdf({
      jobId: row.jobId,
      buffer: merged,
      displayName,
      kind: SIGNED_FILE_KIND,
      contentType: 'application/pdf',
      uploadedByUserId: null,
      timelineActorUserId: null,
    });
    const jobRow = await this.jobsRepo.findOne({ where: { id: row.jobId } });
    if (!jobRow) {
      throw new NotFoundException('Job not found');
    }
    jobRow.contractSigned = true;
    await this.jobsRepo.save(jobRow);
    row.status = 'signed';
    row.signedAt = new Date(signedAtIso);
    row.signedFileId = savedFile.id;
    row.auditPayload = auditPayload;
    await this.signatureRepo.save(row);
    await this.timelineRepo.save(
      this.timelineRepo.create({
        jobId: row.jobId,
        type: 'contract_signed',
        payload: {
          signatureRequestId: row.id,
          referenceCode: row.referenceCode,
          fileId: savedFile.id,
          attachmentFilename,
          signedAt: signedAtIso,
        },
        createdByUserId: null,
      }),
    );
    return { ok: true, referenceCode: row.referenceCode };
  }
}
