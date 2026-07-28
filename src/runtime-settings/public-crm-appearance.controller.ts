import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { RuntimeSettingsService } from './runtime-settings.service';

@ApiTags('Public')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: 60_000, limit: 60 } })
@Controller('public/crm-appearance')
export class PublicCrmAppearanceController {
  constructor(private readonly settings: RuntimeSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Public CRM branding and theme hints',
    description:
      'No authentication. Returns merged appearance settings (display name, logos, colors, theme preference) for the login screen and browser chrome.',
  })
  getPublicCrmAppearance() {
    return this.settings.getPublicCrmAppearance();
  }
}
