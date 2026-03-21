import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
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
  constructor(private readonly schedule: ScheduleService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Schedule aggregate (assignments + kW by team/day)',
    description:
      '**Query:** `from`, `to` (inclusive `YYYY-MM-DD`, max **366** days), optional **`teamId`**. **Installer:** rows where you are **`staffUserId`** OR assignment **`teamId`** matches **`users.teamId`**; **403** if `teamId` filter ≠ your team or you have no team but pass `teamId`.',
  })
  @ApiForbiddenResponse({
    description: '**403** — installer `teamId` filter not allowed.',
  })
  get(
    @Query() query: GetScheduleQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.schedule.get(query, { userId, role });
  }
}
