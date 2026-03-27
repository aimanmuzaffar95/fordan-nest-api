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
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { AttendanceService } from './attendance.service';
import { ClockInDto } from './dto/clock-in.dto';
import { ClockOutDto } from './dto/clock-out.dto';
import {
  ListAttendanceSessionsQueryDto,
  ListMyAttendanceSessionsQueryDto,
} from './dto/list-attendance-sessions-query.dto';
import { PatchAttendanceSessionDto } from './dto/patch-attendance-session.dto';

@ApiTags('Attendance')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('clock-in')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({ summary: 'Start an attendance session' })
  clockIn(
    @Body() dto: ClockInDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.attendance.clockIn(userId, role, dto);
  }

  @Post('clock-out')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({ summary: 'Close the open attendance session' })
  clockOut(
    @Body() dto: ClockOutDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }
    return this.attendance.clockOut(userId, dto);
  }

  @Get('me/session')
  @Roles(UserRole.INSTALLER)
  @ApiOperation({ summary: 'Current open session for installer' })
  mySession(
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }
    return this.attendance.getMyOpenSession(userId);
  }

  @Get('me/sessions')
  @Roles(UserRole.INSTALLER)
  @ApiOperation({ summary: 'List own sessions in a date range' })
  mySessions(
    @Query() query: ListMyAttendanceSessionsQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }
    return this.attendance.listMySessions(userId, query);
  }

  @Get('sessions')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'List attendance sessions (manager scoped)' })
  listSessions(
    @Query() query: ListAttendanceSessionsQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.attendance.listSessions(userId, role, query);
  }

  @Patch('sessions/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Correct attendance times (audited fields)' })
  patchSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchAttendanceSessionDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.attendance.patchSession(id, userId, role, dto);
  }
}
