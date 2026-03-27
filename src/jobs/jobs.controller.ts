import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Req,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPreconditionFailedResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { FindJobsQueryDto } from './dto/find-jobs-query.dto';
import { TransitionJobStageDto } from './dto/transition-job-stage.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { UpdateJobPipelineDto } from './dto/update-job-pipeline.dto';
import { UpdateJobProposalConfigDto } from './dto/update-job-proposal-config.dto';
import { JobsService } from './jobs.service';
import { LeadCaptureInsightsService } from '../reports/lead-capture-insights.service';

@ApiTags('Jobs')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly leadCaptureInsightsService: LeadCaptureInsightsService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'List jobs',
    description:
      '**Installer:** only jobs where you are `assignedStaffUserId` or (when set) `assignedTeamId` matches your `users.teamId`. **Admin/Manager:** all jobs (subject to filters).',
  })
  list(
    @Query() query: FindJobsQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.jobs.list(query, { userId, role });
  }

  /** Static path must stay above `@Get(':id')` so it is not swallowed as a UUID. */
  @Get('lead-capture-insights')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Lead capture analytics (public form submissions)',
    description:
      'Aggregates job notes from public lead submissions (`__FORDAN_LEAD_META__` line or legacy “Lead source: public web form” text).',
  })
  leadCaptureInsights() {
    return this.leadCaptureInsightsService.getInsights();
  }

  @Post(':id/stage')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  transitionStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionJobStageDto,
    @Req() req: Request & { user?: { sub: string; role: UserRole } },
  ) {
    return this.jobs.transitionStage(
      req.user?.sub ?? null,
      req.user?.role ?? null,
      id,
      dto.toStage,
      dto.overridePreMeterLock ?? false,
    );
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Get job by id',
    description:
      '**Installer:** **404** if the job is not assigned to you (directly or via team). Same response as unknown id (no leak).',
  })
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.jobs.getOne(id, { userId, role });
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Update non-pipeline job fields',
    description:
      'Currently supports manager assignment updates for the live job detail summary card. Returns the refreshed job detail payload.',
  })
  updateJob(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.jobs.updateJob(id, dto, { userId, role });
  }

  @Get(':id/proposal-config')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Get job proposal configuration',
    description:
      'Returns the persisted proposal-only equipment selections for a job. **Installer:** **404** if the job is not assigned to you.',
  })
  getProposalConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.jobs.getProposalConfig(id, { userId, role });
  }

  @Put(':id/proposal-config')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Replace job proposal configuration',
    description:
      'Persists the proposal-only equipment selection set for the job. Existing proposal selections are replaced atomically.',
  })
  updateProposalConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobProposalConfigDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.jobs.updateProposalConfig(id, dto, { userId, role });
  }

  @Patch(':id/pipeline')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Update job pipeline stage / ordering',
    description:
      '**412 Precondition Failed** (`code: PRECONDITION_FAILED`) when a **non-admin** moves to `installed` without an approved **pre_meter** application. **Admin** may override.',
  })
  @ApiPreconditionFailedResponse({
    description:
      'Stage gating failed — body includes `code: "PRECONDITION_FAILED"` (e.g. pre-meter not approved for `installed`).',
  })
  updatePipeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobPipelineDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    // JwtAuthGuard + RolesGuard should make this safe; still guard for runtime safety.
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.jobs.updateJobPipeline(id, dto, role, userId);
  }
}
