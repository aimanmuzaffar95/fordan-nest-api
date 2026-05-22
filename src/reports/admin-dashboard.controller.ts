import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PermissionsService } from '../permissions/permissions.service';
import { UserRole } from '../users/entities/user-role.enum';
import { AdminDashboardReportsService } from './admin-dashboard.service';
import { AdminDashboardRevenueForecastQueryDto } from './dto/admin-dashboard-revenue-forecast-query.dto';
import { AdminDashboardManagerActivityQueryDto } from './dto/admin-dashboard-manager-activity-query.dto';

@Controller('reports/admin-dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminDashboardController {
  constructor(
    private readonly adminDashboardReports: AdminDashboardReportsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getSummary(
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeReports(req);
    return this.adminDashboardReports.getSummary(viewer);
  }

  @Get('revenue-forecast')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getRevenueForecast(
    @Query() query: AdminDashboardRevenueForecastQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeReports(req);
    return this.adminDashboardReports.getRevenueForecast(
      query.daysAhead,
      viewer,
    );
  }

  @Get('manager-activity')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getManagerActivity(
    @Query() query: AdminDashboardManagerActivityQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeReports(req);
    return this.adminDashboardReports.getManagerActivity(query.limit, viewer);
  }

  private async authorizeReports(
    req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    const effective = await this.permissions.getEffectiveForUser(userId);
    if (this.permissions.hasPermission(effective, 'reports:view_all')) {
      return { userId, role, reportScope: 'all' as const };
    }
    this.permissions.assertPermission(effective, 'reports:view_own');
    return { userId, role, reportScope: 'own' as const };
  }
}
