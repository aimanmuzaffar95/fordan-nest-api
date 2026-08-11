import {
  Body,
  Controller,
  Delete,
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
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { UserRole } from '../users/entities/user-role.enum';
import {
  UpsertDefectDto,
  UpsertInstallVisitDto,
} from './dto/install-execution.dto';
import { UpsertMilestoneDto } from './dto/milestone.dto';
import { CreatePermitDto, UpdatePermitDto } from './dto/permit.dto';
import { CreateProjectNoteDto } from './dto/project-note.dto';
import { ListProjectsQueryDto, UpdateProjectDto } from './dto/project.dto';
import { InstallExecutionService } from './install-execution.service';
import { MilestonesService } from './milestones.service';
import { PermitsService } from './permits.service';
import { ProjectNotesService } from './project-notes.service';
import { INSTALL_READINESS_ITEMS, ProjectsService } from './projects.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

function viewerOf(req: AuthRequest): { userId: string; role: UserRole } {
  const userId = req.user?.sub;
  const role = req.user?.role;
  if (!userId || !role) throw new Error('Missing authenticated user context');
  return { userId, role };
}

@ApiTags('Projects')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly permits: PermitsService,
    private readonly milestones: MilestonesService,
    private readonly execution: InstallExecutionService,
    private readonly notes: ProjectNotesService,
  ) {}

  // ─── Projects ─────────────────────────────────────────────────────────────

  @Get('projects')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:view')
  @ApiOperation({
    summary: 'List projects',
    description:
      'Admins see all; managers see the projects they manage. Returns at most 500 — pass `limit`/`offset` to page beyond that.',
  })
  list(@Req() req: AuthRequest, @Query() query: ListProjectsQueryDto) {
    return this.projects.list(viewerOf(req), {
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('projects/readiness-checklist')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:view')
  @ApiOperation({
    summary: 'The install-readiness checklist definition',
    description: 'Every item must be ticked before a project can be scheduled.',
  })
  readinessChecklist() {
    return { items: INSTALL_READINESS_ITEMS };
  }

  @Get('jobs/:jobId/project')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:view')
  @ApiOperation({
    summary: 'The project created from a job',
    description: 'Null until the job’s contract is signed.',
  })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  byJob(@Param('jobId', ParseUUIDPipe) jobId: string, @Req() req: AuthRequest) {
    return this.projects.findByJob(jobId, viewerOf(req));
  }

  @Get('projects/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:view')
  @ApiOperation({ summary: 'Get a project' })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.projects.findOne(id, viewerOf(req));
  }

  @Patch('projects/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:manage')
  @ApiOperation({
    summary: 'Update a project',
    description:
      'Stage moves are gated — scheduling requires a complete readiness checklist.',
  })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @Req() req: AuthRequest,
  ) {
    return this.projects.update(id, dto, viewerOf(req));
  }

  @Get('projects/:id/readiness')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:view')
  @ApiOperation({ summary: 'Readiness checklist state for a project' })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  readiness(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.projects.readiness(id, viewerOf(req));
  }

  // ─── Permits ──────────────────────────────────────────────────────────────

  @Get('projects/:id/permits')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:view')
  @ApiOperation({ summary: 'Permits on a project' })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  listPermits(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.permits.listForProject(id, viewerOf(req));
  }

  @Post('projects/:id/permits')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:manage')
  @ApiOperation({ summary: 'Add a permit to a project' })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  createPermit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePermitDto,
    @Req() req: AuthRequest,
  ) {
    return this.permits.create(id, dto, viewerOf(req));
  }

  @Patch('permits/:permitId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:manage')
  @ApiOperation({ summary: 'Update a permit' })
  @ApiParam({ name: 'permitId', description: 'Permit UUID' })
  updatePermit(
    @Param('permitId', ParseUUIDPipe) permitId: string,
    @Body() dto: UpdatePermitDto,
    @Req() req: AuthRequest,
  ) {
    return this.permits.update(permitId, dto, viewerOf(req));
  }

  @Delete('permits/:permitId')
  @Roles(UserRole.ADMIN)
  @RequirePermission('project:manage')
  @ApiOperation({ summary: 'Delete a permit (admin)' })
  @ApiParam({ name: 'permitId', description: 'Permit UUID' })
  removePermit(
    @Param('permitId', ParseUUIDPipe) permitId: string,
    @Req() req: AuthRequest,
  ) {
    return this.permits.remove(permitId, viewerOf(req));
  }

  @Post('permits/sweep-stalled')
  @Roles(UserRole.ADMIN)
  @RequirePermission('project:manage')
  @ApiOperation({
    summary: 'Flag permits stalled with an authority (admin)',
    description: 'Runs automatically on the SLA sweep.',
  })
  sweepStalledPermits() {
    return this.permits.sweepStalled();
  }

  // ─── Inspection / interconnection / PTO ───────────────────────────────────

  @Get('projects/:id/milestones')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:view')
  @ApiOperation({ summary: 'Inspection, interconnection and PTO attempts' })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  listMilestones(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.milestones.listForProject(id, viewerOf(req));
  }

  @Post('projects/:id/milestones')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:manage')
  @ApiOperation({
    summary: 'Create or advance a milestone',
    description:
      'A failed attempt is kept and a new attempt opened, so correction history survives. Passing a milestone advances the project stage; passing PTO completes it.',
  })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  upsertMilestone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertMilestoneDto,
    @Req() req: AuthRequest,
  ) {
    return this.milestones.upsert(id, dto, viewerOf(req));
  }

  // ─── Install execution ────────────────────────────────────────────────────

  @Get('projects/:id/visits')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:view')
  @ApiOperation({ summary: 'Install visits on a project' })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  listVisits(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.execution.listVisits(id, viewerOf(req));
  }

  @Post('projects/:id/visits')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @RequirePermission('project:manage')
  @ApiOperation({
    summary: 'Create or update an install visit',
    description:
      'Partial completion requires a description of the outstanding work, and raises a follow-up task.',
  })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  upsertVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertInstallVisitDto,
    @Req() req: AuthRequest,
  ) {
    return this.execution.upsertVisit(id, dto, viewerOf(req));
  }

  @Get('projects/:id/defects')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @RequirePermission('project:view')
  @ApiOperation({ summary: 'Defects logged on a project' })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  listDefects(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.execution.listDefects(id, viewerOf(req));
  }

  @Post('projects/:id/defects')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @RequirePermission('project:manage')
  @ApiOperation({
    summary: 'Log or update a defect',
    description:
      'Waiving requires a reason and is refused for critical (safety) defects.',
  })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  upsertDefect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertDefectDto,
    @Req() req: AuthRequest,
  ) {
    return this.execution.upsertDefect(id, dto, viewerOf(req));
  }

  // ─── Notes ────────────────────────────────────────────────────────────────

  @Get('projects/:id/notes')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @RequirePermission('project:view')
  @ApiOperation({
    summary: 'Timeline notes on a project',
    description:
      'Newest first. Each note carries the resolved author (never client-supplied text). Installers may read only when assigned to the underlying job (primary or via `assignments`); write and delete stay Admin/Manager.',
  })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  listNotes(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.notes.listForProject(id, viewerOf(req));
  }

  @Post('projects/:id/notes')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:manage')
  @ApiOperation({
    summary: 'Add a note to a project',
    description:
      'A dedicated append-only store — the author is always the authenticated caller, never a request field.',
  })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  createNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProjectNoteDto,
    @Req() req: AuthRequest,
  ) {
    return this.notes.create(id, dto, viewerOf(req));
  }

  @Delete('project-notes/:noteId')
  @Roles(UserRole.ADMIN)
  @RequirePermission('project:manage')
  @ApiOperation({ summary: 'Delete a project note (admin)' })
  @ApiParam({ name: 'noteId', description: 'Project note UUID' })
  removeNote(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: AuthRequest,
  ) {
    return this.notes.remove(noteId, viewerOf(req));
  }

  @Get('projects/:id/blocking-defects')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('project:view')
  @ApiOperation({
    summary: 'Unresolved major/critical defects blocking handover',
  })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  blockingDefects(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.execution.blockingDefects(id, viewerOf(req));
  }
}
