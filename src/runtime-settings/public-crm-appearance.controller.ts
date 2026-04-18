import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RuntimeSettingsService } from './runtime-settings.service';

@ApiTags('Public')
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
