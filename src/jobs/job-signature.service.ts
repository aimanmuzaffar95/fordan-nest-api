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
import { User } from '../users/entities/user.entity';

export const ESIGN_CONSENT_VERSION = '1';

const SIGNED_FILE_KIND = 'signed_paperwork' as UploadKind;
const EMAIL_VERIFY_MIN_RESEND_MS = 60_000;

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
const HEADER_FORWARDED_PROTO = 'x-forwarded-proto';
const HEADER_FORWARDED_HOST = 'x-forwarded-host';

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

function tryPublicApiBaseUrlFromRequest(req?: Request): string | null {
  if (!req?.headers) return null;
  const xfProto = req.headers[HEADER_FORWARDED_PROTO];
  const xfHost = req.headers[HEADER_FORWARDED_HOST];
  const proto = Array.isArray(xfProto) ? xfProto[0] : xfProto;
  const host = Array.isArray(xfHost) ? xfHost[0] : xfHost;

  const effectiveProto =
    (typeof proto === 'string' && proto.trim()) ||
    (typeof req.protocol === 'string' && req.protocol.trim()) ||
    'http';
  const effectiveHost =
    (typeof host === 'string' && host.trim()) ||
    (typeof req.headers.host === 'string' && req.headers.host.trim()) ||
    '';

  if (!effectiveHost) return null;
  return stripTrailingSlashes(`${effectiveProto}://${effectiveHost}`);
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
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly jobs: JobsService,
    private readonly jobQuotation: JobQuotationService,
    private readonly pdfMerge: JobSignaturePdfMergeService,
    private readonly files: FilesService,
    private readonly email: EmailService,
    private readonly customerMessaging: CustomerMessagingRendererService,
    private readonly runtimeSettings: RuntimeSettingsService,
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

  private async requireVerificationToView(): Promise<boolean> {
    const settings = await this.runtimeSettings.getSettings();
    return settings.esignRequireVerificationToView === true;
  }

  private async emailMagicLinkEnabled(): Promise<boolean> {
    const settings = await this.runtimeSettings.getSettings();
    return settings.esignEmailMagicLinkEnabled === true;
  }

  private maskEmail(email: string): string {
    const e = email.trim();
    const at = e.indexOf('@');
    if (at <= 0) return '***';
    const name = e.slice(0, at);
    const domain = e.slice(at + 1);
    const visible = name.length <= 2 ? name[0] ?? '*' : name.slice(0, 2);
    return `${visible}${'*'.repeat(
      Math.min(8, Math.max(1, name.length - visible.length)),
    )}@${domain}`;
  }

  private buildProposalSnapshot(ctx: {
    orderNumber: string;
    customerName: string;
    customerEmail: string;
    customerAddress?: string;
    company?: {
      legalName?: string;
      tradingName?: string;
      abn?: string;
      email?: string;
      phone?: string;
      website?: string;
      address?: string;
    };
    preparedBy?: { name: string; email?: string | null; phone?: string | null };
    preparedAtIso?: string;
    expiresAtIso?: string;
    system?: {
      systemTypeLabel?: string;
      systemSizeLabel?: string;
      batterySizeLabel?: string;
      installDate?: string | null;
      depositAmount?: number | null;
      projectPrice?: number | null;
    };
    terms?: { markdown: string | null; version: number };
    acceptance?: { markdown: string | null; version: number };
    payment?: { instructions: string | null };
    money?: { currency: string; taxRatePercent: number };
    sections?: {
      showSystemDetails: boolean;
      showIncludedServices: boolean;
      showWarranty: boolean;
      showAssumptions: boolean;
    };
    includedServices?: { markdown: string | null; version: number };
    warranty?: { markdown: string | null; version: number };
    assumptions?: { markdown: string | null; version: number };
    adjustments?: Array<{ label: string; amountExclTax: number }>;
    adjustmentsVersion?: number;
    proposalItems: Array<{
      name: string;
      subtitle: string;
      quantity: number;
      proposalUnitPrice: number;
      lineTotal: number;
      equipmentType: string;
      wattage: number | null;
      inverterCapacityKw: number | null;
      batteryCapacityKwh: number | null;
      stockStatus: string | null;
    }>;
    proposalTotal: number;
  }): Record<string, unknown> {
    const currency = ctx.money?.currency?.trim() || 'USD';
    const taxRatePercent =
      Number.isFinite(ctx.money?.taxRatePercent) && (ctx.money?.taxRatePercent ?? 0) >= 0
        ? Number(ctx.money?.taxRatePercent)
        : 0;
    const subtotalExclTax = ctx.proposalTotal;
    const adjustments = Array.isArray(ctx.adjustments) ? ctx.adjustments : [];
    const adjustmentsTotalExclTax = adjustments.reduce(
      (sum, a) => sum + (Number(a.amountExclTax) || 0),
      0,
    );
    const adjustedSubtotalExclTax = subtotalExclTax + adjustmentsTotalExclTax;
    const taxAmount = adjustedSubtotalExclTax * (taxRatePercent / 100);
    const totalInclTax = adjustedSubtotalExclTax + taxAmount;

    return {
      kind: 'job_signature_request_proposal_v1',
      orderNumber: ctx.orderNumber,
      preparedAt: ctx.preparedAtIso ?? new Date().toISOString(),
      lastUpdatedAt: ctx.preparedAtIso ?? new Date().toISOString(),
      expiresAt: ctx.expiresAtIso ?? null,
      currency,
      company: ctx.company ?? null,
      preparedBy: ctx.preparedBy ?? null,
      customer: {
        name: ctx.customerName,
        email: ctx.customerEmail,
        address: ctx.customerAddress ?? '',
      },
      sections: ctx.sections ?? {
        showSystemDetails: true,
        showIncludedServices: true,
        showWarranty: true,
        showAssumptions: true,
      },
      system: ctx.system ?? null,
      quote: {
        items: ctx.proposalItems.map((i) => ({
          label: i.name,
          subtitle: i.subtitle,
          quantity: i.quantity,
          unitPrice: i.proposalUnitPrice,
          total: i.lineTotal,
          meta: {
            equipmentType: i.equipmentType,
            wattage: i.wattage,
            inverterCapacityKw: i.inverterCapacityKw,
            batteryCapacityKwh: i.batteryCapacityKwh,
            stockStatus: i.stockStatus,
          },
        })),
        subtotalExclTax,
        adjustments: adjustments.map((a) => ({
          label: String(a.label ?? 'Adjustment'),
          amountExclTax: Number(a.amountExclTax) || 0,
        })),
        adjustmentsVersion: Number(ctx.adjustmentsVersion ?? 1),
        adjustedSubtotalExclTax,
        taxRatePercent,
        taxAmount,
        totalInclTax,
      },
      acceptance: {
        markdown: ctx.acceptance?.markdown ?? null,
        version: ctx.acceptance?.version ?? 1,
      },
      includedServices: {
        markdown: ctx.includedServices?.markdown ?? null,
        version: ctx.includedServices?.version ?? 1,
      },
      warranty: {
        markdown: ctx.warranty?.markdown ?? null,
        version: ctx.warranty?.version ?? 1,
      },
      assumptions: {
        markdown: ctx.assumptions?.markdown ?? null,
        version: ctx.assumptions?.version ?? 1,
      },
      policies: {
        termsMarkdown: ctx.terms?.markdown ?? null,
        termsVersion: ctx.terms?.version ?? 1,
      },
      payment: {
        instructions: ctx.payment?.instructions ?? null,
      },
    };
  }

  private parseQuoteAdjustmentsJson(raw: string | null): Array<{
    label: string;
    amountExclTax: number;
  }> {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((row) => {
          if (!row || typeof row !== 'object') return null;
          const r = row as Record<string, unknown>;
          const label = typeof r.label === 'string' ? r.label.trim() : '';
          const amount =
            typeof r.amountExclTax === 'number'
              ? r.amountExclTax
              : typeof r.amountExclTax === 'string'
                ? Number(r.amountExclTax)
                : NaN;
          if (!label || !Number.isFinite(amount)) return null;
          return { label, amountExclTax: amount };
        })
        .filter((x): x is { label: string; amountExclTax: number } => Boolean(x));
    } catch {
      return [];
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
    const [ctx, preparedByUser] = await Promise.all([
      this.jobQuotation.validateQuotationPrerequisites(jobId, viewer),
      this.usersRepo.findOne({
        where: { id: viewer.userId },
        select: ['id', 'firstName', 'lastName', 'emailAddress', 'phoneNumber'],
      }),
    ]);
    const base = await this.resolvePublicBaseUrl(req);
    const rawToken = randomToken();
    const tokenHash = sha256Hex(rawToken);
    const ref = await this.uniqueReferenceCode();
    const expiresAt = new Date(Date.now() + (await this.resolveTokenTtlMs()));
    await this.cancelOpenRequests(jobId);
    const runtime = await this.runtimeSettings.getSettings();
    const company = runtime.companyProfileSettings;
    const companySnapshot = {
      legalName: company.legalName?.trim() ?? '',
      tradingName: company.tradingName?.trim() ?? '',
      abn: company.abn?.trim() ?? '',
      email: company.supportEmail?.trim() ?? '',
      phone: company.supportPhone?.trim() ?? '',
      website: company.websiteUrl?.trim() ?? '',
      address: [
        company.addressLine1,
        company.addressLine2,
        [company.suburb, company.state, company.postcode].filter(Boolean).join(' '),
        company.country,
      ]
        .filter((s) => typeof s === 'string' && s.trim())
        .map((s) => String(s).trim())
        .join(', '),
    };

    const row = this.signatureRepo.create({
      jobId,
      status: 'pending' as JobSignatureRequestStatus,
      tokenHash,
      referenceCode: ref,
      expiresAt,
      emailVerifyTokenHash: null,
      emailVerifySentAt: null,
      emailVerifiedAt: null,
      verifiedAt: null,
      sentAt: null,
      viewedAt: null,
      signedAt: null,
      signerEmail: ctx.customerEmail,
      signerName: ctx.customerName,
      proposalSnapshot: this.buildProposalSnapshot({
        orderNumber: ctx.orderNumber,
        customerName: ctx.customerName,
        customerEmail: ctx.customerEmail,
        customerAddress: ctx.jobDetail.customer?.address?.trim() ?? '',
        company: companySnapshot,
        preparedBy: {
          name: preparedByUser
            ? `${preparedByUser.firstName} ${preparedByUser.lastName}`.trim()
            : viewer.role === UserRole.ADMIN
              ? 'Admin'
              : 'Manager',
          email: preparedByUser?.emailAddress ?? null,
          phone: preparedByUser?.phoneNumber ?? null,
        },
        preparedAtIso: new Date().toISOString(),
        expiresAtIso: expiresAt.toISOString(),
        system: {
          systemTypeLabel: String(ctx.jobDetail.job.systemType ?? ''),
          systemSizeLabel: String(ctx.jobDetail.job.systemSizeKw ?? ''),
          batterySizeLabel: String(ctx.jobDetail.job.batterySizeKwh ?? ''),
          installDate: ctx.jobDetail.job.installDate ?? null,
          depositAmount: Number(ctx.jobDetail.job.depositAmount ?? 0),
          projectPrice: Number(ctx.jobDetail.job.projectPrice ?? 0),
        },
        terms: {
          markdown: runtime.esignProposalTermsMarkdown,
          version: runtime.esignProposalTermsVersion,
        },
        acceptance: {
          markdown: runtime.esignProposalAcceptanceMarkdown,
          version: runtime.esignProposalAcceptanceVersion,
        },
        sections: {
          showSystemDetails: runtime.esignProposalShowSystemDetails,
          showIncludedServices: runtime.esignProposalShowIncludedServices,
          showWarranty: runtime.esignProposalShowWarranty,
          showAssumptions: runtime.esignProposalShowAssumptions,
        },
        includedServices: {
          markdown: runtime.esignProposalIncludedServicesMarkdown,
          version: runtime.esignProposalIncludedServicesVersion,
        },
        warranty: {
          markdown: runtime.esignProposalWarrantyMarkdown,
          version: runtime.esignProposalWarrantyVersion,
        },
        assumptions: {
          markdown: runtime.esignProposalAssumptionsMarkdown,
          version: runtime.esignProposalAssumptionsVersion,
        },
        payment: {
          instructions: runtime.billingSettings.paymentInstructions,
        },
        money: {
          currency: runtime.companyProfileSettings.currency,
          taxRatePercent: runtime.billingSettings.defaultTaxRatePercent,
        },
        adjustments: this.parseQuoteAdjustmentsJson(
          runtime.esignProposalQuoteAdjustmentsJson,
        ),
        adjustmentsVersion: runtime.esignProposalQuoteAdjustmentsVersion,
        proposalItems: ctx.proposalItems,
        proposalTotal: ctx.proposalTotal,
      }),
      signedFileId: null,
      auditPayload: null,
      createdByUserId: viewer.userId,
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
    const row = await this.findSignatureRowByRawToken(rawToken);
    if (!row) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    await this.expireIfNeeded(row);
    if (row.status === 'expired' || row.status === 'cancelled') {
      throw new NotFoundException('Invalid or expired signing link');
    }

    const requireVerify = await this.requireVerificationToView();
    const hasVerify = row.verifiedAt != null || row.status === 'signed';

    const base = {
      referenceCode: row.referenceCode,
      expiresAt: row.expiresAt.toISOString(),
      consentVersion: ESIGN_CONSENT_VERSION,
      verification: {
        required: requireVerify,
        unlocked: hasVerify,
        methods: {
          emailMagicLinkEnabled: await this.emailMagicLinkEnabled(),
          smsOtpEnabled:
            (await this.runtimeSettings.getSettings()).esignSmsOtpEnabled ===
            true,
        },
        masked: {
          email: this.maskEmail(row.signerEmail),
        },
      },
    };

    if (requireVerify && !hasVerify) {
      return {
        ...base,
        state: 'locked' as const,
        signingComplete: row.status === 'signed',
        signedAt: row.signedAt?.toISOString() ?? null,
      };
    }

    const jobFull = await this.jobsRepo.findOne({
      where: { id: row.jobId },
      relations: { customer: true },
    });
    if (!jobFull) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    const firstName = jobFull.customer?.firstName?.trim() || 'Customer';
    const proposal = row.proposalSnapshot ?? null;
    if (row.status === 'signed') {
      return {
        ...base,
        state: 'unlocked' as const,
        orderNumber: jobFull.orderNumber,
        customerFirstName: firstName,
        proposal,
        signingComplete: true,
        signedAt: row.signedAt?.toISOString() ?? null,
      };
    }
    return {
      ...base,
      state: 'unlocked' as const,
      orderNumber: jobFull.orderNumber,
      customerFirstName: firstName,
      proposal,
      signingComplete: false,
      signedAt: null,
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
    if (
      (await this.requireVerificationToView()) &&
      !row.verifiedAt &&
      row.status !== 'signed'
    ) {
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
    return { ok: true };
  }

  async getPublicQuotationPdf(rawToken: string): Promise<{
    buffer: Buffer;
    filename: string;
  }> {
    const row = await this.findSignatureRowByRawToken(rawToken);
    if (!row) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    await this.expireIfNeeded(row);
    if (row.status === 'expired' || row.status === 'cancelled') {
      throw new NotFoundException('Invalid or expired signing link');
    }
    if (
      (await this.requireVerificationToView()) &&
      !row.verifiedAt &&
      row.status !== 'signed'
    ) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    const { pdfBuffer, attachmentFilename } =
      await this.jobQuotation.buildValidatedQuotationPdf(row.jobId, undefined);
    return { buffer: pdfBuffer, filename: attachmentFilename };
  }

  async getPublicSignedPdfStream(rawToken: string): Promise<{
    stream: Readable;
    contentLength?: number;
    contentType: string | null;
    filename: string;
  }> {
    const row = await this.findSignatureRowByRawToken(rawToken);
    if (!row) {
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
    const safeName = (
      dl.file.displayName ??
      dl.file.originalName ??
      'signed-quotation.pdf'
    )
      .replace(/[\r\n"]/g, '_')
      .trim();
    return {
      stream: dl.stream,
      contentLength: dl.contentLength,
      contentType: dl.file.contentType,
      filename: safeName || 'signed-quotation.pdf',
    };
  }

  async startPublicEmailVerification(
    rawToken: string,
    req: Request,
  ): Promise<{ ok: true }> {
    const requireVerify = await this.requireVerificationToView();
    if (!requireVerify) {
      return { ok: true };
    }
    if (!(await this.emailMagicLinkEnabled())) {
      throw new BadRequestException('Email verification is disabled');
    }

    const row = await this.findSignatureRowByRawToken(rawToken);
    if (!row) {
      throw new NotFoundException('Invalid or expired signing link');
    }
    await this.expireIfNeeded(row);
    if (row.status === 'expired' || row.status === 'cancelled') {
      throw new NotFoundException('Invalid or expired signing link');
    }
    if (row.verifiedAt || row.status === 'signed') {
      return { ok: true };
    }
    if (
      row.emailVerifySentAt &&
      Date.now() - row.emailVerifySentAt.getTime() < EMAIL_VERIFY_MIN_RESEND_MS
    ) {
      throw new BadRequestException({
        message: 'Please wait before requesting another verification email.',
        code: 'VERIFY_EMAIL_RATE_LIMIT',
      });
    }

    const rawMagic = randomToken();
    row.emailVerifyTokenHash = sha256Hex(rawMagic);
    row.emailVerifySentAt = new Date();
    await this.signatureRepo.save(row);

    const publicWebBase = await this.resolvePublicBaseUrl(req);
    const apiBase =
      process.env.PUBLIC_API_BASE_URL?.trim() ||
      tryPublicApiBaseUrlFromRequest(req);
    if (!apiBase) {
      throw new ServiceUnavailableException(
        'Public API base URL is not configured',
      );
    }
    const verifyUrl = `${stripTrailingSlashes(apiBase)}/api/public/sign/verify-email/${rawMagic}?accessToken=${encodeURIComponent(
      rawToken,
    )}`;

    const subject = `Verify to view your proposal (${row.referenceCode})`;
    const html = `
      <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
        <h2 style="margin:0 0 12px 0;">Verify to view your proposal</h2>
        <p style="margin:0 0 16px 0;">Click the button below to unlock and view your proposal.</p>
        <p style="margin:0 0 20px 0;">
          <a href="${verifyUrl}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;">
            Verify email & view proposal
          </a>
        </p>
        <p style="margin:0;color:#6b7280;font-size:12px;">If you didn’t request this, you can ignore this email.</p>
      </div>
    `.trim();

    await this.email.send({
      to: row.signerEmail,
      subject,
      html,
    });

    await this.timelineRepo.save(
      this.timelineRepo.create({
        jobId: row.jobId,
        type: 'signature_view_verification_email_sent',
        payload: {
          signatureRequestId: row.id,
          referenceCode: row.referenceCode,
          sentAt: row.emailVerifySentAt.toISOString(),
        },
        createdByUserId: null,
      }),
    );

    return { ok: true };
  }

  async completePublicEmailVerification(
    rawMagicToken: string,
    accessToken: string,
    req: Request,
  ): Promise<{ redirectUrl: string }> {
    const publicWebBase = await this.resolvePublicBaseUrl(req);
    const requireVerify = await this.requireVerificationToView();
    if (!requireVerify) {
      return {
        redirectUrl: `${publicWebBase}/sign/${encodeURIComponent(accessToken)}`,
      };
    }
    if (!(await this.emailMagicLinkEnabled())) {
      throw new NotFoundException('Invalid verification link');
    }
    const magic = rawMagicToken?.trim();
    if (!magic || magic.length < 16) {
      throw new NotFoundException('Invalid verification link');
    }
    const row = await this.signatureRepo.findOne({
      where: { emailVerifyTokenHash: sha256Hex(magic) },
    });
    if (!row) {
      throw new NotFoundException('Invalid verification link');
    }
    await this.expireIfNeeded(row);
    if (row.status === 'expired' || row.status === 'cancelled') {
      throw new NotFoundException('Invalid verification link');
    }
    if (sha256Hex(accessToken) !== row.tokenHash) {
      throw new NotFoundException('Invalid verification link');
    }
    if (!row.emailVerifiedAt) {
      row.emailVerifiedAt = new Date();
    }
    if (!row.verifiedAt) {
      row.verifiedAt = new Date();
    }
    row.emailVerifyTokenHash = null;
    await this.signatureRepo.save(row);

    await this.timelineRepo.save(
      this.timelineRepo.create({
        jobId: row.jobId,
        type: 'signature_view_verified',
        payload: {
          signatureRequestId: row.id,
          referenceCode: row.referenceCode,
          verifiedAt: row.verifiedAt.toISOString(),
          method: 'email_magic_link',
        },
        createdByUserId: null,
      }),
    );

    return {
      redirectUrl: `${publicWebBase}/sign/${encodeURIComponent(accessToken)}`,
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
    if (
      (await this.requireVerificationToView()) &&
      !row.verifiedAt &&
      row.status !== 'signed'
    ) {
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
