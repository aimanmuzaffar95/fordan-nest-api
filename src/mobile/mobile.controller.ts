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

    const role = this.resolveDashboardRole(roleQuery, jwtRole);

    // #region agent log
    fetch('http://127.0.0.1:7752/ingest/ca057992-4764-4f84-bd14-1a66cbaafdf9', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '0a7f43',
      },
      body: JSON.stringify({
        sessionId: '0a7f43',
        runId: 'post-fix',
        hypothesisId: 'H2',
        location: 'mobile.controller.ts:getDashboard',
        message: 'dashboard role resolved',
        data: { roleQuery: roleQuery ?? null, jwtRole, effectiveRole: role },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    return this.dashboardService.getDashboard(role, userId);
  }

  /** Ignore `role` query when it does not match the JWT role (prevents privilege spoofing). */
  private resolveDashboardRole(
    roleQuery: string | undefined,
    jwtRole: UserRole,
  ): UserRole {
    if (
      roleQuery === UserRole.ADMIN ||
      roleQuery === UserRole.MANAGER ||
      roleQuery === UserRole.INSTALLER
    ) {
      return roleQuery === jwtRole ? roleQuery : jwtRole;
    }
    return jwtRole;
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
