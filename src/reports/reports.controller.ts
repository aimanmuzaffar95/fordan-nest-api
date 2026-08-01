import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsService } from '../permissions/permissions.service';
import { UserRole } from '../users/entities/user-role.enum';
import { AdminDashboardReportsService } from './admin-dashboard.service';
import { InstallerReportsService } from './installer-reports.service';
import { ReportsInstallersQueryDto } from './dto/reports-installers-query.dto';
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
    private readonly installerReports: InstallerReportsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('installers')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Installer performance leaderboard',
    description:
      'Per active installer: installs completed, kW installed, on-time %. ' +
      '**Query:** optional `from`, `to` (`YYYY-MM-DD`); default last 180 days. ' +
      '**Admin:** all jobs. **Manager (own scope):** only jobs where `jobs.managerId = you`.',
  })
  async getInstallers(
    @Query() query: ReportsInstallersQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeReports(req);
    return this.installerReports.getLeaderboard(query, viewer);
  }

  @Get('installers/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Installer performance detail',
    description:
      'Leaderboard metrics plus monthly install series and recent jobs for one installer.',
  })
  async getInstallerDetail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ReportsInstallersQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeReports(req);
    return this.installerReports.getInstallerDetail(id, query, viewer);
  }

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
