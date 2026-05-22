import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsService } from '../permissions/permissions.service';
import { UserRole } from '../users/entities/user-role.enum';
import { AdminDashboardReportsService } from './admin-dashboard.service';
import { ReportsKpisQueryDto } from './dto/reports-kpis-query.dto';
import { ReportsPipelineQueryDto } from './dto/reports-pipeline-query.dto';
import { ReportsRevenueQueryDto } from './dto/reports-revenue-query.dto';

@ApiTags('Reports')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: AdminDashboardReportsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('kpis')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Headline report KPIs',
    description:
      '**Admin:** all jobs. **Manager:** only jobs where `jobs.managerId = you`.',
  })
  async getKpis(
    @Query() query: ReportsKpisQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeReports(req);
    return this.reportsService.getKpis(query.rangeDays, viewer);
  }

  @Get('pipeline')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Pipeline report aggregates',
    description:
      '**Admin:** all jobs. **Manager:** only jobs where `jobs.managerId = you`.',
  })
  async getPipeline(
    @Query() query: ReportsPipelineQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeReports(req);
    return this.reportsService.getPipeline(query.rangeDays, viewer);
  }

  @Get('revenue')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Revenue report (invoiced vs paid)',
    description:
      '**Query:** optional `from`, `to` (`YYYY-MM-DD`) or `rangeDays`. **Admin:** all jobs. **Manager:** only jobs where `jobs.managerId = you`.',
  })
  async getRevenue(
    @Query() query: ReportsRevenueQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeReports(req);
    return this.reportsService.getRevenue(query, viewer);
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
