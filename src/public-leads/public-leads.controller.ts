import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  PublicLeadTrackingDto,
  SubmitPublicLeadDto,
} from './dto/submit-public-lead.dto';
import { PublicLeadsService } from './public-leads.service';

function flattenValidationErrors(errors: ValidationError[]): string[] {
  const out: string[] = [];
  const walk = (errs: ValidationError[]) => {
    for (const e of errs) {
      if (e.constraints) {
        out.push(...Object.values(e.constraints));
      }
      if (e.children?.length) {
        walk(e.children);
      }
    }
  };
  walk(errors);
  return out;
}

@ApiTags('Public leads')
@Controller('public/leads')
@UseGuards(ThrottlerGuard)
export class PublicLeadsController {
  constructor(private readonly publicLeads: PublicLeadsService) {}

  @Post()
  @ApiOperation({
    summary: 'Submit a lead from the public progressive form (no JWT)',
    description:
      'Rate limited per IP (see `PUBLIC_LEAD_THROTTLE_*` env). Requires `PUBLIC_LEAD_ACTOR_USER_ID`. Optional `PUBLIC_LEAD_SUBMISSION_SECRET` — header `X-Public-Lead-Secret` or body `submissionSecret`. Optional SMTP + `LEAD_NOTIFY_EMAILS` for internal email; `PUBLIC_LEAD_SEND_CONFIRMATION_EMAIL` for prospect auto-reply.',
  })
  async submit(
    /** `object` skips the app-wide ValidationPipe (Object is not validated). */
    @Body() raw: object,
    @Headers('x-public-lead-secret') secretHeader?: string,
  ) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException({ message: 'Body must be a JSON object' });
    }
    const body = raw as Record<string, unknown>;
    const trackingRaw = body.tracking;
    const rest = { ...body };
    delete rest.tracking;

    const dto = plainToInstance(SubmitPublicLeadDto, rest, {
      enableImplicitConversion: true,
    });
    const coreErrors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: false,
    });
    if (coreErrors.length) {
      throw new BadRequestException({
        message: flattenValidationErrors(coreErrors),
      });
    }

    if (trackingRaw !== undefined && trackingRaw !== null) {
      if (typeof trackingRaw !== 'object' || Array.isArray(trackingRaw)) {
        throw new BadRequestException({
          message: ['tracking must be a plain object'],
        });
      }
      const tracking = plainToInstance(PublicLeadTrackingDto, trackingRaw, {
        enableImplicitConversion: true,
      });
      const trackingErrors = await validate(tracking, {
        whitelist: true,
        forbidNonWhitelisted: false,
        forbidUnknownValues: false,
      });
      if (trackingErrors.length) {
        throw new BadRequestException({
          message: flattenValidationErrors(trackingErrors),
        });
      }
      dto.tracking = tracking;
    }

    return this.publicLeads.submit(dto, secretHeader);
  }
}
