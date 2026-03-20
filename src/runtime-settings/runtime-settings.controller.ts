import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from './runtime-settings.service';
import { UpdateCalendarScopeEnforcedDto } from './dto/update-calendar-scope-enforced.dto';

@ApiTags('Runtime Settings')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RuntimeSettingsController {
  constructor(private readonly settings: RuntimeSettingsService) {}

  @Get('calendar-scope-enforced')
  @ApiOperation({
    summary: 'Calendar visibility enforcement toggle (runtime)',
    description:
      'When enabled, manager/installer calendar results are scoped to assignments assigned to them. Admin always sees all.',
  })
  getCalendarScopeEnforced() {
    return {
      calendarScopeEnforced: this.settings.getCalendarScopeEnforced(),
    };
  }

  @Patch('calendar-scope-enforced')
  @ApiOperation({
    summary: 'Update calendar visibility enforcement toggle (runtime)',
    description:
      'Admin-only. Changes are in-memory and reset on container restart.',
  })
  @Roles(UserRole.ADMIN)
  patchCalendarScopeEnforced(
    @Body() dto: UpdateCalendarScopeEnforcedDto,
  ) {
    this.settings.setCalendarScopeEnforced(dto.calendarScopeEnforced);
    return {
      calendarScopeEnforced: this.settings.getCalendarScopeEnforced(),
    };
  }
}

