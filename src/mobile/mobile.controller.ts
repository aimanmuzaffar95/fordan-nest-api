import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
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
import { ListAuditLogQueryDto } from '../system-audit/dto/list-audit-log-query.dto';
import { SystemAuditLogService } from '../system-audit/system-audit-log.service';
import { UserRole } from '../users/entities/user-role.enum';
import { MobileDashboardService } from './mobile-dashboard.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

@ApiTags('Mobile')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('mobile')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MobileController {
  constructor(
    private readonly dashboardService: MobileDashboardService,
    private readonly auditLog: SystemAuditLogService,
  ) {}

  @Get('dashboard')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Role-shaped dashboard KPIs for Fordan CRM mobile',
  })
  getDashboard(
    @Query('role') roleQuery: string | undefined,
    @Req() req: AuthRequest,
  ) {
    const userId = req.user?.sub;
    const jwtRole = req.user?.role ?? UserRole.INSTALLER;
    if (!userId) throw new Error('Missing authenticated user context');

    const role =
      roleQuery === UserRole.ADMIN ||
      roleQuery === UserRole.MANAGER ||
      roleQuery === UserRole.INSTALLER
        ? roleQuery
        : jwtRole;

    return this.dashboardService.getDashboard(role, userId);
  }

  @Get('audit-log')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Paginated system audit log for mobile admin',
    description:
      'Same payload as `GET /audit-log`. Admin-only; newest first. Query: `page` (default 1), `pageSize` (default 25, max 100).',
  })
  listAuditLog(@Query() query: ListAuditLogQueryDto) {
    return this.auditLog.listPaginated(query);
  }
}
