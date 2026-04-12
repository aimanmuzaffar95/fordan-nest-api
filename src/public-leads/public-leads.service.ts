import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CustomersService } from '../customers/customers.service';
import { JobsService } from '../jobs/jobs.service';
import { EmailService } from '../email/email.service';
import { SubmitPublicLeadDto } from './dto/submit-public-lead.dto';
import { CreateJobDto } from '../jobs/dto/create-job.dto';
import { UserRole } from '../users/entities/user-role.enum';
import { envBool } from '../common/env.util';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';

@Injectable()
export class PublicLeadsService {
  constructor(
    private readonly customers: CustomersService,
    private readonly jobs: JobsService,
    private readonly email: EmailService,
    private readonly runtimeSettings: RuntimeSettingsService,
  ) {}

  async submit(
    dto: SubmitPublicLeadDto,
    secretFromHeader?: string,
  ): Promise<{ customerId: string; jobId: string }> {
    const requiredSecret = process.env.PUBLIC_LEAD_SUBMISSION_SECRET?.trim();
    if (requiredSecret) {
      const provided =
        secretFromHeader?.trim() || dto.submissionSecret?.trim() || '';
      if (provided !== requiredSecret) {
        throw new ForbiddenException('Invalid or missing submission secret');
      }
    }

    const actorId = process.env.PUBLIC_LEAD_ACTOR_USER_ID?.trim();
    if (!actorId) {
      throw new ServiceUnavailableException(
        'Public lead form is not configured. Set PUBLIC_LEAD_ACTOR_USER_ID to a valid CRM user UUID (e.g. an admin).',
      );
    }

    const addressParts = [dto.suburb, dto.postcode].filter(Boolean);
    const address =
      addressParts.length > 0 ? addressParts.join(' ') : undefined;

    const customer = await this.customers.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      address,
      phone: dto.phone,
      email: dto.email,
      acquisitionSource: 'website_form',
    });

    const settings = await this.runtimeSettings.getSettings();
    const systemType = dto.systemIntent;
    const systemSizeKw =
      systemType === 'battery' ? 0 : settings.quickLeadDefaultSystemSizeKw;
    const batterySizeKwh =
      systemType === 'solar'
        ? undefined
        : settings.quickLeadDefaultBatterySizeKwh;

    const t = dto.tracking;
    const formSlug = t?.formSlug?.trim() || 'default';
    const leadMeta = {
      v: 1 as const,
      formSlug,
      utmSource: t?.utmSource?.trim() || undefined,
      utmMedium: t?.utmMedium?.trim() || undefined,
      utmCampaign: t?.utmCampaign?.trim() || undefined,
      pageReferrer: t?.pageReferrer?.trim()?.slice(0, 500) || undefined,
      selfReportedSource: t?.selfReportedSource?.trim() || undefined,
    };
    const metaLine = `__FORDAN_LEAD_META__${JSON.stringify(leadMeta)}`;

    const humanParts = [
      'Lead source: public web form',
      `Form: ${formSlug}`,
      t?.utmSource?.trim() ? `utm_source: ${t.utmSource.trim()}` : '',
      t?.utmMedium?.trim() ? `utm_medium: ${t.utmMedium.trim()}` : '',
      t?.utmCampaign?.trim() ? `utm_campaign: ${t.utmCampaign.trim()}` : '',
      t?.selfReportedSource?.trim()
        ? `Heard about us: ${t.selfReportedSource.trim()}`
        : '',
      dto.propertyType
        ? `Property type: ${dto.propertyType.replace(/_/g, ' ')}`
        : '',
      dto.notes?.trim() ? `Notes: ${dto.notes.trim()}` : '',
    ].filter(Boolean);

    const notesBody = [metaLine, '', humanParts.join(' | ')].join('\n');

    const jobDto: CreateJobDto = {
      systemType,
      systemSizeKw,
      batterySizeKwh,
      projectPrice: settings.quickLeadDefaultProjectPrice,
      contractSigned: false,
      depositPaid: false,
      depositAmount: 0,
      pipelineStage: 'lead',
      preMeterStatus: 'pending',
      postMeterStatus: 'pending',
      notes: notesBody,
    };

    const job = await this.jobs.createJob(
      customer.id,
      jobDto,
      UserRole.ADMIN,
      actorId,
    );

    const notifyEmails = (process.env.LEAD_NOTIFY_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (notifyEmails.length > 0) {
      this.email.fireAndForget({
        to: notifyEmails,
        subject: `New web lead: ${dto.firstName} ${dto.lastName}`,
        template: 'public-lead-internal',
        context: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          suburb: dto.suburb ?? '—',
          postcode: dto.postcode ?? '',
          systemIntent: dto.systemIntent,
          customerId: customer.id,
          jobId: job.id,
        },
      });
    }

    if (envBool(process.env.PUBLIC_LEAD_SEND_CONFIRMATION_EMAIL, false)) {
      const subject =
        process.env.PUBLIC_LEAD_CONFIRMATION_SUBJECT?.trim() ||
        'We received your enquiry';

      this.email.fireAndForget({
        to: dto.email,
        subject,
        template: 'public-lead-confirmation',
        context: { firstName: dto.firstName },
      });
    }

    return { customerId: customer.id, jobId: job.id };
  }
}
