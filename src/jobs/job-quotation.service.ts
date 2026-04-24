import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerMessagingRendererService } from '../email/customer-messaging-renderer.service';
import { EmailService } from '../email/email.service';
import { FilesService } from '../files/files.service';
import { CrmBrandingUploadSlot } from '../files/crm-branding.constants';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { SendJobQuotationResponseDto } from './dto/send-job-quotation-response.dto';
import { JobQuotationPdfService } from './job-quotation-pdf.service';
import { JobsService, type JobListViewer } from './jobs.service';
import type { JobDetailResponseDto } from './dto/job-detail-response.dto';

export type ProposalConfigItem = {
  id: string;
  equipmentType: 'panel' | 'inverter' | 'battery' | 'misc';
  equipmentId: string;
  name: string;
  subtitle: string;
  quantity: number;
  defaultUnitPrice: number;
  proposalUnitPrice: number;
  lineTotal: number;
  stockStatus: string | null;
  wattage: number | null;
  inverterCapacityKw: number | null;
  batteryCapacityKwh: number | null;
  efficiency: number | null;
};

export type ValidatedQuotationContext = {
  jobDetail: JobDetailResponseDto;
  proposalItems: ProposalConfigItem[];
  proposalTotal: number;
  customerName: string;
  orderNumber: string;
  attachmentFilename: string;
  customerEmail: string;
};

export type ValidatedQuotationPdfResult = ValidatedQuotationContext & {
  pdfBuffer: Buffer;
};

@Injectable()
export class JobQuotationService {
  constructor(
    private readonly jobs: JobsService,
    private readonly email: EmailService,
    private readonly customerMessaging: CustomerMessagingRendererService,
    private readonly quotationPdf: JobQuotationPdfService,
    private readonly settings: RuntimeSettingsService,
    private readonly files: FilesService,
    @InjectRepository(TimelineEvent)
    private readonly timelineEventsRepo: Repository<TimelineEvent>,
  ) {}

  /**
   * Validates proposal config + pricing (same rules as quotation email / signing).
   * When `viewer` is omitted, skips installer/manager RBAC (internal signing pipeline only).
   */
  async validateQuotationPrerequisites(
    jobId: string,
    viewer?: JobListViewer,
    options?: { allowInstallerPdfDownload?: boolean },
  ): Promise<ValidatedQuotationContext> {
    if (
      viewer?.role === UserRole.INSTALLER &&
      !options?.allowInstallerPdfDownload
    ) {
      throw new BadRequestException(
        'Installers cannot send customer quotations',
      );
    }

    const [jobDetail, proposalConfig] = await Promise.all([
      this.jobs.getOne(jobId, viewer),
      this.jobs.getProposalConfig(jobId, viewer),
    ]);

    const customer = jobDetail.customer;
    if (!customer?.email?.trim()) {
      throw new BadRequestException('Customer email is missing for this job');
    }

    const proposalItems = proposalConfig.items as ProposalConfigItem[];
    if (proposalItems.length === 0) {
      throw new BadRequestException(
        'Cannot send quotation without a saved proposal configuration',
      );
    }

    const proposalTotal = proposalItems.reduce(
      (sum, item) => sum + item.lineTotal,
      0,
    );
    const jobTotal = Number(jobDetail.job.projectPrice ?? 0);

    if (Math.abs(jobTotal - proposalTotal) > 0.01) {
      throw new BadRequestException(
        'Quotation pricing is out of sync with the job total. Reconcile the proposal configuration before sending.',
      );
    }

    const customerName =
      `${customer.firstName} ${customer.lastName}`.trim() || 'Customer';
    const orderNumber = jobDetail.job.orderNumber;
    const attachmentFilename = `quotation_${orderNumber.toLowerCase()}.pdf`;

    return {
      jobDetail,
      proposalItems,
      proposalTotal,
      customerName,
      orderNumber,
      attachmentFilename,
      customerEmail: customer.email,
    };
  }

  async buildValidatedQuotationPdf(
    jobId: string,
    viewer?: JobListViewer,
    options?: { allowInstallerPdfDownload?: boolean },
  ): Promise<ValidatedQuotationPdfResult> {
    const ctx = await this.validateQuotationPrerequisites(
      jobId,
      viewer,
      options,
    );
    const {
      jobDetail,
      proposalItems,
      proposalTotal,
      customerName,
      orderNumber,
      attachmentFilename,
      customerEmail,
    } = ctx;

    const customer = jobDetail.customer;
    if (!customer) {
      throw new BadRequestException('Customer email is missing for this job');
    }

    const pdfCopy = await this.customerMessaging.resolveQuotationPdfCopy({
      customerName,
      orderNumber,
    });

    const runtime = await this.settings.getSettings();
    const appearanceRaw = runtime.crmAppearanceSettings as unknown as Record<
      string,
      unknown
    >;
    const currency =
      typeof runtime.companyProfileSettings.currency === 'string' &&
      runtime.companyProfileSettings.currency.trim()
        ? runtime.companyProfileSettings.currency.trim()
        : 'USD';
    const appearanceName =
      typeof appearanceRaw.appDisplayName === 'string'
        ? appearanceRaw.appDisplayName.trim()
        : '';
    const appearanceHex =
      typeof appearanceRaw.primaryHex === 'string'
        ? appearanceRaw.primaryHex.trim()
        : '';
    const brandName = appearanceName || pdfCopy.brandName;
    const primaryHex = appearanceHex || pdfCopy.primaryHex;

    let logoBytes: Buffer | undefined;
    try {
      const download = await this.files.getPublicCrmBrandingDownload(
        CrmBrandingUploadSlot.logo,
      );
      logoBytes = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        download.stream.on('data', (c: Buffer | Uint8Array) =>
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
        );
        download.stream.on('end', () => resolve(Buffer.concat(chunks)));
        download.stream.on('error', reject);
      });
    } catch {
      // Logo is optional.
      logoBytes = undefined;
    }

    const pdfBuffer = await this.quotationPdf.buildQuotationPdf({
      attachmentFilename,
      customerName,
      customerAddress: customer.address?.trim() ?? '',
      customerEmail,
      orderNumber,
      systemTypeLabel: this.toSystemTypeLabel(jobDetail.job.systemType),
      systemSizeLabel: this.toSystemSizeLabel(jobDetail.job.systemSizeKw),
      batterySizeLabel: this.toBatterySizeLabel(jobDetail.job.batterySizeKwh),
      proposalItems,
      proposalTotal,
      pdfBrandName: brandName,
      pdfPrimaryHex: primaryHex,
      pdfHeadline: pdfCopy.headline,
      pdfThankYou: pdfCopy.thankYou,
      pdfFooterNote: pdfCopy.footerNote,
      currency,
      logoImageBytes: logoBytes,
    });

    return { ...ctx, pdfBuffer };
  }

  async sendQuotation(
    jobId: string,
    viewer: JobListViewer,
  ): Promise<SendJobQuotationResponseDto> {
    const {
      pdfBuffer,
      jobDetail,
      proposalItems,
      proposalTotal,
      customerName,
      orderNumber,
      attachmentFilename,
      customerEmail,
    } = await this.buildValidatedQuotationPdf(jobId, viewer);

    const customer = jobDetail.customer;
    const sentAt = new Date().toISOString();

    const { subject, html } =
      await this.customerMessaging.renderQuotationCustomerEmail({
        customerName,
        orderNumber,
        projectAddress:
          customer?.address?.trim() || 'Address available on file',
        systemTypeLabel: this.toSystemTypeLabel(jobDetail.job.systemType),
        systemSizeLabel: this.toSystemSizeLabel(jobDetail.job.systemSizeKw),
        batterySizeLabel: this.toBatterySizeLabel(jobDetail.job.batterySizeKwh),
        proposalItems: proposalItems.map((item) => ({
          label: item.name,
          subtitle: item.subtitle,
          quantity: item.quantity,
          proposalUnitPrice: this.formatCurrency(item.proposalUnitPrice),
          lineTotal: this.formatCurrency(item.lineTotal),
        })),
        proposalTotal: this.formatCurrency(proposalTotal),
      });

    await this.email.send({
      to: customerEmail,
      subject,
      html,
      attachments: [
        {
          filename: attachmentFilename,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    await this.timelineEventsRepo.save(
      this.timelineEventsRepo.create({
        jobId,
        type: 'quotation_sent',
        payload: {
          recipientEmail: customerEmail,
          proposalTotal: proposalTotal.toFixed(2),
          attachmentFilename,
          sentAt,
        },
        createdByUserId: viewer.userId,
      }),
    );

    return {
      jobId,
      recipientEmail: customerEmail,
      sentAt,
      proposalTotal,
      attachmentFilename,
    };
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  private toSystemTypeLabel(systemType: string): string {
    if (systemType === 'both') {
      return 'Solar + Battery';
    }
    if (systemType === 'battery') {
      return 'Battery';
    }
    return 'Solar';
  }

  private toSystemSizeLabel(systemSizeKw: string | null): string {
    const size = Number(systemSizeKw ?? 0);
    return size > 0 ? `${size.toFixed(1)}kW solar array` : 'Not included';
  }

  private toBatterySizeLabel(batterySizeKwh: string | null): string {
    const size = Number(batterySizeKwh ?? 0);
    return size > 0 ? `${size.toFixed(1)}kWh battery storage` : 'Not included';
  }
}
