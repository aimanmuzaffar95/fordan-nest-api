import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CustomersService } from '../customers/customers.service';
import { JobsService } from '../jobs/jobs.service';
import { MailService } from '../mail/mail.service';
import { SubmitPublicLeadDto } from './dto/submit-public-lead.dto';
import { CreateJobDto } from '../jobs/dto/create-job.dto';
import { UserRole } from '../users/entities/user-role.enum';

@Injectable()
export class PublicLeadsService {
  constructor(
    private readonly customers: CustomersService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
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
    });

    const systemType = dto.systemIntent;
    const systemSizeKw = systemType === 'battery' ? 0 : 6.6;
    const batterySizeKwh = systemType === 'solar' ? undefined : 10;

    const metaParts = [
      'Lead source: public web form',
      dto.propertyType
        ? `Property type: ${dto.propertyType.replace(/_/g, ' ')}`
        : '',
      dto.notes?.trim() ? `Notes: ${dto.notes.trim()}` : '',
    ].filter(Boolean);

    const jobDto: CreateJobDto = {
      systemType,
      systemSizeKw,
      batterySizeKwh,
      projectPrice: 0,
      contractSigned: false,
      depositPaid: false,
      depositAmount: 0,
      pipelineStage: 'lead',
      preMeterStatus: 'pending',
      postMeterStatus: 'pending',
      notes: metaParts.join(' | ') || undefined,
    };

    const job = await this.jobs.createJob(
      customer.id,
      jobDto,
      UserRole.ADMIN,
      actorId,
    );

    this.mail.notifyPublicLeadCreated({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      suburb: dto.suburb,
      postcode: dto.postcode,
      systemIntent: dto.systemIntent,
      customerId: customer.id,
      jobId: job.id,
    });

    return { customerId: customer.id, jobId: job.id };
  }
}
