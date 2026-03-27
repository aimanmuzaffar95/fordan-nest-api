import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from './runtime-settings.service';
import { UpdateAdminSettingsDto } from './dto/update-admin-settings.dto';

@ApiTags('Settings')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RuntimeSettingsController {
  constructor(private readonly settings: RuntimeSettingsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Get persisted admin settings',
    description:
      'Returns the global configuration used by the Settings screen and downstream alert/scheduling logic. Readable by any authenticated user.',
  })
  getSettings() {
    return this.settings.getSettings();
  }

  @Patch()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update persisted admin settings',
    description:
      'Admin-only. Persists the provided subset of settings and returns the full saved configuration.',
  })
  updateSettings(
    @Body() dto: UpdateAdminSettingsDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }
    return this.settings.updateSettings(dto, userId);
  }
}
