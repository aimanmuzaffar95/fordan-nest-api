import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { IsNull } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomersService } from '../customers/customers.service';
import { CustomerResponseDto } from '../customers/dto/customer-response.dto';
import { JobsService } from '../jobs/jobs.service';
import { EmailService } from '../email/email.service';
import { SubmitPublicLeadDto } from './dto/submit-public-lead.dto';
import { CreateJobDto } from '../jobs/dto/create-job.dto';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { envBool } from '../common/env.util';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { LeadRoutingService } from '../territories/lead-routing.service';

@Injectable()
export class PublicLeadsService {
  constructor(
    private readonly customers: CustomersService,
    private readonly jobs: JobsService,
    private readonly email: EmailService,
    private readonly runtimeSettings: RuntimeSettingsService,
    private readonly leadRouting: LeadRoutingService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /**
   * Public leads are recorded against a CRM user. `PUBLIC_LEAD_ACTOR_USER_ID`
   * overrides; otherwise fall back to the oldest active admin so the form
   * works without extra configuration.
   */
  private async resolveActorUserId(): Promise<string> {
    const configured = process.env.PUBLIC_LEAD_ACTOR_USER_ID?.trim();
    if (configured) {
      const user = await this.users.findOne({
        where: { id: configured, deletedAt: IsNull() },
      });
      if (!user) {
        throw new ServiceUnavailableException(
          'PUBLIC_LEAD_ACTOR_USER_ID does not match an active CRM user.',
        );
      }
      return user.id;
    }

    const admin = await this.users.findOne({
      where: { role: UserRole.ADMIN, active: true, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    if (!admin) {
      throw new ServiceUnavailableException(
        'Public lead form is not configured. Create an admin user or set PUBLIC_LEAD_ACTOR_USER_ID to a valid CRM user UUID.',
      );
    }
    return admin.id;
  }

  async submit(
    dto: SubmitPublicLeadDto,
    secretFromHeader?: string,
  ): Promise<{ customerId: string; jobId: string }> {
    const requiredSecret = process.env.PUBLIC_LEAD_SUBMISSION_SECRET?.trim();
    if (requiredSecret) {
      const provided =
        secretFromHeader?.trim() || dto.submissionSecret?.trim() || '';
      // Constant-time comparison (same pattern as the installer setup token).
      const a = Buffer.from(provided, 'utf8');
      const b = Buffer.from(requiredSecret, 'utf8');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new ForbiddenException('Invalid or missing submission secret');
      }
    }

    const actorId = await this.resolveActorUserId();

    const addressParts = [dto.suburb, dto.postcode].filter(Boolean);
    const address =
      addressParts.length > 0 ? addressParts.join(' ') : undefined;

    const t = dto.tracking;
    const formSlug = t?.formSlug?.trim() || 'default';

    let customer: CustomerResponseDto;
    try {
      customer = await this.customers.create({
        firstName: dto.firstName,
        lastName: dto.lastName,
        address,
        phone: dto.phone,
        email: dto.email,
        acquisitionSource: 'website_form',
        // First-class attribution (PRD v2, Phase 0). The note blob below is
        // kept for now as the human-readable summary; these columns are what
        // reporting and routing read.
        leadSource: t?.utmSource?.trim() || 'website_form',
        leadMedium: t?.utmMedium?.trim() || undefined,
        leadCampaign: t?.utmCampaign?.trim() || undefined,
        leadFormSlug: formSlug,
        leadPageReferrer: t?.pageReferrer?.trim()?.slice(0, 500) || undefined,
        leadSelfReportedSource: t?.selfReportedSource?.trim() || undefined,
      });
    } catch (err) {
      if (!(err instanceof ConflictException)) {
        throw err;
      }
      // Dedupe silently: a repeat enquiry reuses the existing customer and
      // still gets the normal success response, so the public form cannot be
      // used to probe whether an email already exists in the CRM (API-07).
      const existing = await this.customers.findByEmailInternal(dto.email);
      if (!existing) {
        throw err;
      }
      customer = existing;
    }

    const settings = await this.runtimeSettings.getSettings();
    const systemType = dto.systemIntent;
    const systemSizeKw =
      systemType === 'battery' ? 0 : settings.quickLeadDefaultSystemSizeKw;
    const batterySizeKwh =
      systemType === 'solar'
        ? undefined
        : settings.quickLeadDefaultBatterySizeKwh;

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

    // Route the lead to a territory owner. Self-guarding and post-commit: a
    // routing failure must never reject a captured lead.
    await this.leadRouting.routeLead({
      customerId: customer.id,
      jobId: job.id,
      address,
      postcode: dto.postcode,
    });

    return { customerId: customer.id, jobId: job.id };
  }
}
