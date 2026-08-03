import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionKey } from '../permissions/permission-catalog';
import { PermissionsService } from '../permissions/permissions.service';
import { UserRole } from '../users/entities/user-role.enum';
import { AttendanceService } from './attendance.service';
import {
  GlobalClockInDto,
  GlobalClockOutDto,
} from './dto/global-attendance.dto';
import { AttendanceSessionsQueryDto } from './dto/attendance-sessions-query.dto';
import { TeamSessionsQueryDto } from './dto/team-sessions-query.dto';
import { PatchSessionDto } from './dto/patch-session.dto';

type AuthenticatedRequest = Request & {
  user?: { sub?: string; role?: UserRole };
};

@ApiTags('Attendance')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceSessionController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly permissions: PermissionsService,
  ) {}

  @Post('clock-in')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({ summary: 'Clock in (global session API)' })
  async clockIn(
    @Body() dto: GlobalClockInDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.authorize(req, 'attendance:self:clock');
    const session = await this.attendanceService.clockInGlobal(dto, actor);
    return { session };
  }

  @Post('clock-out')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({ summary: 'Clock out (global session API)' })
  async clockOut(
    @Body() dto: GlobalClockOutDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.authorize(req, 'attendance:self:clock');
    const session = await this.attendanceService.clockOutGlobal(dto, actor);
    return { session };
  }

  @Get('me/session')
  @Roles(UserRole.INSTALLER)
  @ApiOperation({ summary: 'Get my open attendance session' })
  async getMySession(@Req() req: AuthenticatedRequest) {
    const actor = await this.authorize(req, 'attendance:self:view');
    const session = await this.attendanceService.getMyOpenSession(actor.userId);
    return { session };
  }

  @Get('sessions')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'List team attendance sessions (admin/manager)',
    description:
      'Optional from/to date range and userId filter; newest first, capped at 500.',
  })
  async listTeamSessions(
    @Query() query: TeamSessionsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.authorize(req, 'attendance:view');
    const items = await this.attendanceService.listTeamSessions(
      query.from,
      query.to,
      query.userId,
    );
    return { items };
  }

  @Patch('sessions/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Correct a team attendance session (adds a correction note)',
  })
  async patchSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchSessionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.authorize(req, 'attendance:view');
    const session = await this.attendanceService.patchSessionCorrection(
      id,
      dto.correctionNote,
      actor.userId,
    );
    return { session };
  }

  @Get('me/sessions')
  @Roles(UserRole.INSTALLER)
  @ApiOperation({ summary: 'List my attendance sessions in date range' })
  async listMySessions(
    @Query() query: AttendanceSessionsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.authorize(req, 'attendance:self:view');
    const items = await this.attendanceService.listMySessions(
      actor.userId,
      query.from,
      query.to,
    );
    return { items };
  }

  private async authorize(
    req: AuthenticatedRequest,
    permission: PermissionKey,
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    const effective = await this.permissions.getEffectiveForUser(userId);
    this.permissions.assertPermission(effective, permission);
    return {
      userId,
      role,
      jobScope:
        effective.scopes.job === 'all' ? ('all' as const) : ('own' as const),
      canViewJobFinancials: this.permissions.hasPermission(
        effective,
        'job:financials:view',
      ),
    };
  }
}
