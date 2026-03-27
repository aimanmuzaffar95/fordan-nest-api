import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { AdminDashboardReportsService } from './admin-dashboard.service';
import { AdminDashboardRevenueForecastQueryDto } from './dto/admin-dashboard-revenue-forecast-query.dto';
import { AdminDashboardManagerActivityQueryDto } from './dto/admin-dashboard-manager-activity-query.dto';

@Controller('reports/admin-dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminDashboardController {
  constructor(
    private readonly adminDashboardReports: AdminDashboardReportsService,
  ) {}

  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  getSummary(
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.adminDashboardReports.getSummary({ userId, role });
  }

  @Get('revenue-forecast')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  getRevenueForecast(
    @Query() query: AdminDashboardRevenueForecastQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.adminDashboardReports.getRevenueForecast(query.daysAhead, {
      userId,
      role,
    });
  }

  @Get('manager-activity')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  getManagerActivity(
    @Query() query: AdminDashboardManagerActivityQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.adminDashboardReports.getManagerActivity(query.limit, {
      userId,
      role,
    });
  }
}
