import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { SubmitPublicLeadDto } from './dto/submit-public-lead.dto';
import { PublicLeadsService } from './public-leads.service';

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
  submit(
    @Body() dto: SubmitPublicLeadDto,
    @Headers('x-public-lead-secret') secretHeader?: string,
  ) {
    return this.publicLeads.submit(dto, secretHeader);
  }
}
