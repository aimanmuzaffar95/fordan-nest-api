import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
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
import { PermissionsService } from '../permissions/permissions.service';
import { UserRole } from '../users/entities/user-role.enum';
import { GetScheduleQueryDto } from './dto/get-schedule-query.dto';
import { ScheduleService } from './schedule.service';

@ApiTags('Schedule')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('schedule')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScheduleController {
  constructor(
    private readonly schedule: ScheduleService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Schedule aggregate (assignments + daily installer load)',
    description:
      '**Query:** `from`, `to` (inclusive `YYYY-MM-DD`, max **366** days). **Admin:** all rows. **Manager:** when `calendarScopeEnforced=true`, rows for jobs where `job.managerId` matches the viewer. **Installer:** only rows where you are the assigned `staffUserId`.',
  })
  async get(
    @Query() query: GetScheduleQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    const effective = await this.permissions.getEffectiveForUser(userId);
    this.permissions.assertPermission(effective, 'schedule:view');
    const scheduleScope =
      effective.scopes.schedule === 'all' ||
      effective.scopes.schedule === 'managed' ||
      effective.scopes.schedule === 'self'
        ? effective.scopes.schedule
        : undefined;
    return this.schedule.get(query, {
      userId,
      role,
      scheduleScope,
    });
  }
}
