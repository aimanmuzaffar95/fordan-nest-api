import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
  getSummary() {
    return this.adminDashboardReports.getSummary();
  }

  @Get('revenue-forecast')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  getRevenueForecast(@Query() query: AdminDashboardRevenueForecastQueryDto) {
    return this.adminDashboardReports.getRevenueForecast(query.daysAhead);
  }

  @Get('manager-activity')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  getManagerActivity(@Query() query: AdminDashboardManagerActivityQueryDto) {
    return this.adminDashboardReports.getManagerActivity(query.limit);
  }
}
