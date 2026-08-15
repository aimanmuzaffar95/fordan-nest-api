import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { CustomerMessagingRendererService } from '../email/customer-messaging-renderer.service';
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
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { ProposalsService } from '../proposals/proposals.service';
import { ProposalVersion } from '../proposals/entities/proposal-version.entity';

export const ESIGN_CONSENT_VERSION = '1';

const SIGNED_FILE_KIND = 'signed_paperwork' as UploadKind;
const PROPOSAL_FILE_KIND = 'proposal_pdf' as UploadKind;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function randomToken(): string {
  return randomBytes(32).toString('hex');
}

function referenceCode(): string {
  return `SIG-${randomBytes(4).toString('hex').toUpperCase()}`;
}

const HEADER_PUBLIC_WEB_BASE_URL = 'x-public-web-base-url';

function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, '');
}

function isLocalDevHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

function parseEsignAllowedOriginsEnv(): Set<string> {
  const raw = process.env.ESIGN_ALLOWED_PUBLIC_ORIGINS?.trim() ?? '';
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => stripTrailingSlashes(s.trim()))
      .filter((p) => p.length > 0),
  );
}

function toHttpOrigin(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return stripTrailingSlashes(`${u.protocol}//${u.host}`);
  } catch {
    return null;
  }
}

function tryPublicBaseUrlFromRequest(req?: Request): string | null {
  if (!req?.headers) return null;

  const candidates: string[] = [];
  const h = req.headers[HEADER_PUBLIC_WEB_BASE_URL];
  const headerVal = Array.isArray(h) ? h[0] : h;
  if (typeof headerVal === 'string' && headerVal.trim()) {
    candidates.push(headerVal.trim());
  }
  if (typeof req.headers.origin === 'string' && req.headers.origin.trim()) {
    candidates.push(req.headers.origin.trim());
  }
  if (typeof req.headers.referer === 'string' && req.headers.referer.trim()) {
    try {
      candidates.push(new URL(req.headers.referer.trim()).origin);
    } catch {
      /* ignore malformed Referer */
    }
  }

  const allowlist = parseEsignAllowedOriginsEnv();
  const trustAny =
    (process.env.ESIGN_TRUST_BROWSER_ORIGIN ?? '').toLowerCase() === 'true' ||
    (process.env.ESIGN_TRUST_BROWSER_ORIGIN ?? '').trim() === '1';

  for (const c of candidates) {
    const origin = toHttpOrigin(c);
    if (!origin) continue;
    let hostname: string;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      continue;
    }
    if (isLocalDevHostname(hostname)) {
      return origin;
    }
    if (allowlist.has(origin)) {
      return origin;
    }
    if (trustAny) {
      return origin;
    }
  }

  return null;
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

@Injectable()
export class JobSignatureService {
  constructor(
    @InjectRepository(JobSignatureRequest)
    private readonly signatureRepo: Repository<JobSignatureRequest>,
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    @InjectRepository(TimelineEvent)
    private readonly timelineRepo: Repository<TimelineEvent>,
    @InjectRepository(ProposalVersion)
    private readonly proposalVersionsRepo: Repository<ProposalVersion>,
    private readonly jobs: JobsService,
    private readonly jobQuotation: JobQuotationService,
    private readonly pdfMerge: JobSignaturePdfMergeService,
    private readonly files: FilesService,
    private readonly email: EmailService,
    private readonly customerMessaging: CustomerMessagingRendererService,
    private readonly runtimeSettings: RuntimeSettingsService,
    private readonly proposals: ProposalsService,
  ) {}

  private assertStaff(viewer: JobListViewer): void {
    if (viewer.role === UserRole.INSTALLER) {
      throw new BadRequestException(
        'Installers cannot create signature requests',
      );
    }
  }

  private async resolvePublicBaseUrl(req?: Request): Promise<string> {
    const payload = await this.runtimeSettings.getSettings();
    const fromDb = payload.esignPublicBaseUrl?.trim();
    if (fromDb) {
      return stripTrailingSlashes(fromDb);
    }
    const fromEnv = process.env.ESIGN_PUBLIC_BASE_URL?.trim() ?? '';
    if (fromEnv) {
      return stripTrailingSlashes(fromEnv);
    }
    const fromRequest = tryPublicBaseUrlFromRequest(req);
    if (fromRequest) {
      return fromRequest;
    }
    throw new BadRequestException({
      message:
        'E-sign web URL is not configured. Use Settings (admin), set ESIGN_PUBLIC_BASE_URL on the API, add ESIGN_ALLOWED_PUBLIC_ORIGINS (comma-separated), or open the CRM from localhost / send X-Public-Web-Base-Url from the web app.',
      code: 'ESIGN_PUBLIC_BASE_URL_MISSING',
    });
  }

  private async resolveTokenTtlMs(): Promise<number> {
    const payload = await this.runtimeSettings.getSettings();
    let days = payload.esignTokenTtlDays;
    if (!Number.isFinite(days) || days < 1 || days > 90) {
      days = Number(process.env.ESIGN_TOKEN_TTL_DAYS ?? '14');
    }
    const safe = Number.isFinite(days) && days > 0 && days <= 90 ? days : 14;
    return safe * 86400000;
  }

  private async expireIfNeeded(row: JobSignatureRequest): Promise<void> {
    if (
      row.status === 'signed' ||
      row.status === 'cancelled' ||
      row.status === 'superseded'
    ) {
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
    req?: Request,
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
    const base = await this.resolvePublicBaseUrl(req);
    const rawToken = randomToken();
    const tokenHash = sha256Hex(rawToken);
    const ref = await this.uniqueReferenceCode();
    const expiresAt = new Date(Date.now() + (await this.resolveTokenTtlMs()));
    await this.cancelOpenRequests(jobId, 'quotation');
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
      documentSource: 'quotation',
      proposalVersionId: null,
    });
    const saved = await this.signatureRepo.save(row);
    const signingUrl = `${base}/sign/${rawToken}`;
    if (sendEmail) {
      try {
        const { subject, html } =
          await this.customerMessaging.renderSignatureRequestCustomerEmail({
            customerName: ctx.customerName,
            orderNumber: ctx.orderNumber,
            signingUrl,
            referenceCode: ref,
          });
        await this.email.send({
          to: ctx.customerEmail,
          subject,
          html,
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

  private async findSignatureRowByRawToken(
    rawToken: string,
  ): Promise<JobSignatureRequest | null> {
    const token = rawToken?.trim();
    if (!token || token.length < 16) {
      return null;
    }
    const tokenHash = sha256Hex(token);
    return this.signatureRepo.findOne({ where: { tokenHash } });
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

  private async cancelOpenRequests(
    jobId: string,
    documentSource: 'quotation' | 'proposal',
  ): Promise<void> {
    await this.signatureRepo.update(
      { jobId, documentSource, status: 'pending' as JobSignatureRequestStatus },
      { status: 'cancelled' },
    );
    await this.signatureRepo.update(
      { jobId, documentSource, status: 'viewed' as JobSignatureRequestStatus },
      { status: 'cancelled' },
    );
  }

  /**
   * Retires any still-open proposal signature request(s) for a job because
   * a *new* proposal version is being sent — never because the customer did
   * anything. Uses `superseded`, not `cancelled`, specifically so
   * `getPublicSession` never reports this to the holder of the old link as
   * "you declined" (that label is reserved for `declinePublicProposal`).
   */
  private async supersedeOpenProposalRequests(jobId: string): Promise<void> {
    await this.signatureRepo.update(
      {
        jobId,
        documentSource: 'proposal' as JobSignatureRequest['documentSource'],
        status: 'pending' as JobSignatureRequestStatus,
      },
      { status: 'superseded' },
    );
    await this.signatureRepo.update(
      {
        jobId,
        documentSource: 'proposal' as JobSignatureRequest['documentSource'],
        status: 'viewed' as JobSignatureRequestStatus,
      },
      { status: 'superseded' },
    );
  }

  /**
   * Mints a signing/acceptance link for a `ProposalVersion` (P6). Reuses the
   * exact same token/request machinery as `createRequest`, but sends no
   * generic "please sign" email — the caller (job-proposal-send service)
   * sends its own branded proposal email with the same link as the CTA, and
   * completion binds to the stored `sentPdfFileId` snapshot, not a live
   * regeneration.
   */
  async createProposalSignatureRequest(
    jobId: string,
    proposalVersionId: string,
    signerEmail: string,
    signerName: string,
    createdByUserId: string,
    req?: Request,
  ): Promise<{
    id: string;
    signingUrl: string;
    referenceCode: string;
    expiresAt: string;
  }> {
    const base = await this.resolvePublicBaseUrl(req);
    const rawToken = randomToken();
    const tokenHash = sha256Hex(rawToken);
    const ref = await this.uniqueReferenceCode();
    const expiresAt = new Date(Date.now() + (await this.resolveTokenTtlMs()));
    await this.supersedeOpenProposalRequests(jobId);
    const row = this.signatureRepo.create({
      jobId,
      status: 'pending' as JobSignatureRequestStatus,
      tokenHash,
      referenceCode: ref,
      expiresAt,
      sentAt: new Date(),
      viewedAt: null,
      signedAt: null,
      signerEmail,
      signerName,
      signedFileId: null,
      auditPayload: null,
      createdByUserId,
      documentSource: 'proposal',
      proposalVersionId,
    });
    const saved = await this.signatureRepo.save(row);
    return {
      id: saved.id,
      signingUrl: `${base}/sign/${rawToken}`,
      referenceCode: ref,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getPublicSession(rawToken: string) {
    const row = await this.findSignatureRowByRawToken(rawToken);
    if (!row) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    await this.expireIfNeeded(row);
    // A cancelled *proposal* request means the customer explicitly declined
    // (`declinePublicProposal`) — a valid, informative outcome for the
    // public page, not an invalid link. A *superseded* proposal request
    // means a coordinator sent a newer version while this link was still
    // open — also not "invalid", but must never be conflated with
    // "declined": the customer never touched this link. A cancelled
    // *quotation* request has no such meaning (quotation requests are only
    // ever replaced, and always with 'cancelled' — see `cancelOpenRequests`),
    // so keep the original 404 behavior there.
    const isProposal = row.documentSource === 'proposal';
    const isDeclinedProposal = row.status === 'cancelled' && isProposal;
    const isSupersededProposal = row.status === 'superseded' && isProposal;
    if (
      row.status === 'expired' ||
      (row.status === 'cancelled' && !isDeclinedProposal) ||
      (row.status === 'superseded' && !isSupersededProposal)
    ) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    const jobFull = await this.jobsRepo.findOne({
      where: { id: row.jobId },
      relations: { customer: true },
    });
    if (!jobFull) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    const firstName = jobFull.customer?.firstName?.trim() || 'Customer';
    const base = {
      orderNumber: jobFull.orderNumber,
      customerFirstName: firstName,
      referenceCode: row.referenceCode,
      expiresAt: row.expiresAt.toISOString(),
      consentVersion: ESIGN_CONSENT_VERSION,
      documentSource: row.documentSource,
    };
    if (row.status === 'signed') {
      return {
        ...base,
        signingComplete: true,
        signedAt: row.signedAt?.toISOString() ?? null,
        declined: false,
        supersededByNewer: false,
      };
    }
    if (isSupersededProposal) {
      // A newer proposal was sent while this link was still open — the
      // document at this link never changed, but it's no longer the
      // current one. Distinct from `declined` on purpose (see comment
      // above): the customer did not decline anything.
      return {
        ...base,
        signingComplete: false,
        signedAt: null,
        declined: false,
        supersededByNewer: true,
      };
    }
    if (isDeclinedProposal) {
      return {
        ...base,
        signingComplete: false,
        signedAt: null,
        declined: true,
        supersededByNewer: false,
      };
    }
    return {
      ...base,
      signingComplete: false,
      signedAt: null,
      declined: false,
      supersededByNewer: false,
    };
  }

  async recordPublicView(rawToken: string): Promise<{ ok: true }> {
    const row = await this.findSignatureRowByRawToken(rawToken);
    if (!row) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    await this.expireIfNeeded(row);
    if (row.status === 'expired' || row.status === 'cancelled') {
      throw new NotFoundException('Invalid or expired signing link');
    }
    if (row.status === 'signed') {
      return { ok: true };
    }
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
    if (row.documentSource === 'proposal' && row.proposalVersionId) {
      // Side-effect-free beyond the view counters (§ ProposalsService.recordView).
      await this.proposals.recordView(row.proposalVersionId);
    }
    return { ok: true };
  }

  async getPublicQuotationPdf(rawToken: string): Promise<{
    buffer: Buffer;
    filename: string;
  }> {
    const row = await this.findSignatureRowByRawToken(rawToken);
    // A proposal-source token must never be able to pull the quotation PDF:
    // it's a live regeneration of a different document (possibly reflecting
    // current, not sent, pricing) that this token was never meant to show.
    if (!row || row.documentSource !== 'quotation') {
      throw new NotFoundException('Invalid or expired signing link');
    }
    await this.expireIfNeeded(row);
    if (row.status === 'expired' || row.status === 'cancelled') {
      throw new NotFoundException('Invalid or expired signing link');
    }
    const { pdfBuffer, attachmentFilename } =
      await this.jobQuotation.buildValidatedQuotationPdf(row.jobId, undefined);
    return { buffer: pdfBuffer, filename: attachmentFilename };
  }

  /**
   * Streams the **stored** proposal PDF snapshot generated at send time —
   * never a live regeneration. This is what makes the "sent proposal stays
   * immutable" guarantee real: the design or pricing can change after
   * sending and the customer still sees, signs, and accepts exactly the
   * document that was emailed.
   */
  async getPublicProposalPdf(rawToken: string): Promise<{
    stream: Readable;
    contentLength?: number;
    contentType: string | null;
    filename: string;
  }> {
    const row = await this.findSignatureRowByRawToken(rawToken);
    if (!row || row.documentSource !== 'proposal' || !row.proposalVersionId) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    await this.expireIfNeeded(row);
    // A cancelled proposal request just means "declined" — the customer can
    // still open the PDF they were shown. Only `expired` blocks access.
    if (row.status === 'expired') {
      throw new NotFoundException('Invalid or expired signing link');
    }
    const version = await this.proposalVersionsRepo.findOne({
      where: { id: row.proposalVersionId },
    });
    if (!version || !version.sentPdfFileId) {
      throw new NotFoundException('Proposal document is not available');
    }
    const dl = await this.files.getJobFileStreamWithKindGate({
      jobId: row.jobId,
      fileId: version.sentPdfFileId,
      allowedKinds: [PROPOSAL_FILE_KIND],
    });
    const safeName = (
      dl.file.displayName ??
      dl.file.originalName ??
      'proposal.pdf'
    )
      .replace(/[\r\n"]/g, '_')
      .trim();
    return {
      stream: dl.stream,
      contentLength: dl.contentLength,
      contentType: dl.file.contentType,
      filename: safeName || 'proposal.pdf',
    };
  }

  async getPublicSignedPdfStream(rawToken: string): Promise<{
    stream: Readable;
    contentLength?: number;
    contentType: string | null;
    filename: string;
  }> {
    const row = await this.findSignatureRowByRawToken(rawToken);
    // `row.signedFileId` is written only by this exact row's own completion
    // flow (`finishClaimedPublicSign`/`finishClaimedProposalSign`) — there
    // is no path that lets one row's `documentSource` read another row's
    // file. The explicit check below is defense in depth, not a fix for a
    // reachable leak: it guards against a future change to this method
    // accepting an externally-supplied file id instead of the row's own.
    if (
      !row ||
      (row.documentSource !== 'quotation' && row.documentSource !== 'proposal')
    ) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    await this.expireIfNeeded(row);
    if (row.status !== 'signed' || !row.signedFileId) {
      throw new NotFoundException('Signed document is not available yet');
    }
    const dl = await this.files.getJobFileStreamWithKindGate({
      jobId: row.jobId,
      fileId: row.signedFileId,
      allowedKinds: [SIGNED_FILE_KIND],
    });
    const defaultName =
      row.documentSource === 'proposal'
        ? 'accepted-proposal.pdf'
        : 'signed-quotation.pdf';
    const safeName = (
      dl.file.displayName ??
      dl.file.originalName ??
      defaultName
    )
      .replace(/[\r\n"]/g, '_')
      .trim();
    return {
      stream: dl.stream,
      contentLength: dl.contentLength,
      contentType: dl.file.contentType,
      filename: safeName || defaultName,
    };
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
    if (row.status === 'superseded') {
      throw new BadRequestException({
        message:
          'A newer version of this proposal has been sent. Please use the link from your most recent email.',
        code: 'PROPOSAL_SUPERSEDED',
      });
    }
    if (row.status === 'signed') {
      throw new BadRequestException({
        message: 'This document has already been signed.',
        code: 'ALREADY_SIGNED',
      });
    }
    const png = parsePngBase64(dto.signaturePngBase64);
    // Race-safe claim (API-05): atomically move pending/viewed -> signed before
    // doing any side-effect work (PDF merge, file writes, timeline). Only the
    // request that wins this conditional UPDATE proceeds; a concurrent
    // double-submit sees zero affected rows and gets the already-signed error.
    const previousStatus = row.status;
    const claim = await this.signatureRepo
      .createQueryBuilder()
      .update(JobSignatureRequest)
      .set({ status: 'signed' })
      .where('id = :id', { id: row.id })
      .andWhere('status IN (:...claimable)', {
        claimable: ['pending', 'viewed'],
      })
      .execute();
    if (!claim.affected) {
      throw new BadRequestException({
        message: 'This document has already been signed.',
        code: 'ALREADY_SIGNED',
      });
    }
    try {
      return await this.finishClaimedPublicSign(row, dto, req, png);
    } catch (err) {
      // Release the claim (best effort) so the customer can retry after a
      // transient failure; only rolls back the status flip made above.
      await this.signatureRepo
        .update({ id: row.id, status: 'signed' }, { status: previousStatus })
        .catch(() => undefined);
      throw err;
    }
  }

  private async finishClaimedPublicSign(
    row: JobSignatureRequest,
    dto: CompletePublicSignatureDto,
    req: Request,
    png: Buffer,
  ): Promise<{ ok: true; referenceCode: string }> {
    if (row.documentSource === 'proposal' && row.proposalVersionId) {
      return this.finishClaimedProposalSign(row, dto, req, png);
    }
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

  /**
   * Proposal acceptance via the e-sign flow. Signs the **stored** proposal
   * PDF (`ProposalVersion.sentPdfFileId`) — the exact document emailed at
   * send time — never a fresh regeneration, so the signature binds to what
   * the customer actually saw even if the design/pricing has since changed.
   * Moves the `ProposalVersion` to `accepted` via `ProposalsService`
   * (job price sync + supersede-siblings + timeline all happen there).
   */
  private async finishClaimedProposalSign(
    row: JobSignatureRequest,
    dto: CompletePublicSignatureDto,
    req: Request,
    png: Buffer,
  ): Promise<{ ok: true; referenceCode: string }> {
    const version = await this.proposalVersionsRepo.findOne({
      where: { id: row.proposalVersionId as string },
    });
    if (!version || !version.sentPdfFileId) {
      throw new NotFoundException('Proposal document is not available');
    }
    const sourcePdf = await this.files.getJobFileStreamWithKindGate({
      jobId: row.jobId,
      fileId: version.sentPdfFileId,
      allowedKinds: [PROPOSAL_FILE_KIND],
    });
    const sourcePdfBuffer = await this.streamToBuffer(sourcePdf.stream);

    const jobRow = await this.jobsRepo.findOne({
      where: { id: row.jobId },
      relations: { customer: true },
    });
    if (!jobRow) {
      throw new NotFoundException('Job not found');
    }
    const customerName =
      `${jobRow.customer?.firstName ?? ''} ${jobRow.customer?.lastName ?? ''}`.trim() ||
      row.signerName ||
      'Customer';

    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : req.ip || req.socket.remoteAddress || 'unknown';
    const signedAtIso = new Date().toISOString();
    const certLines = [
      'Electronic acceptance certificate (Fordan Solar CRM)',
      `Reference: ${row.referenceCode}`,
      `Order: ${jobRow.orderNumber}`,
      `Proposal version: ${version.versionNumber}`,
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
      'This page was generated when the customer accepted the proposal electronically.',
    );
    const merged = await this.pdfMerge.mergeSignatureAndCertificate(
      sourcePdfBuffer,
      png,
      certLines,
    );
    const displayName = `Accepted proposal ${jobRow.orderNumber} v${version.versionNumber}`;
    const auditPayload: Record<string, unknown> = {
      ip,
      userAgent:
        typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent']
          : null,
      signedAt: signedAtIso,
      referenceCode: row.referenceCode,
      consentVersion: ESIGN_CONSENT_VERSION,
      proposalVersionId: version.id,
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

    // Accept the proposal version — job price sync, supersede-siblings and
    // the `proposal_accepted` timeline event all happen inside this call.
    await this.proposals.acceptViaPublicToken(version.id);

    row.status = 'signed';
    row.signedAt = new Date(signedAtIso);
    row.signedFileId = savedFile.id;
    row.auditPayload = auditPayload;
    await this.signatureRepo.save(row);

    return { ok: true, referenceCode: row.referenceCode };
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Customer-facing decline via the public token (P6). Cancels the
   * signature request (so the link no longer offers signing) and moves the
   * `ProposalVersion` to `declined` with the reason + a timeline event.
   */
  async declinePublicProposal(
    rawToken: string,
    reason: string | null,
  ): Promise<{ ok: true }> {
    const row = await this.findSignatureRowByRawToken(rawToken);
    if (!row || row.documentSource !== 'proposal' || !row.proposalVersionId) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    await this.expireIfNeeded(row);
    if (
      row.status === 'expired' ||
      row.status === 'signed' ||
      row.status === 'superseded'
    ) {
      throw new BadRequestException(
        row.status === 'signed'
          ? 'This proposal has already been accepted.'
          : row.status === 'superseded'
            ? 'A newer version of this proposal has been sent. Please use the link from your most recent email.'
            : 'Invalid or expired signing link',
      );
    }
    if (row.status !== 'cancelled') {
      row.status = 'cancelled';
      await this.signatureRepo.save(row);
    }
    await this.proposals.declineViaPublicToken(row.proposalVersionId, reason);
    return { ok: true };
  }
}
