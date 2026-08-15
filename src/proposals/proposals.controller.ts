import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsService } from '../permissions/permissions.service';
import { UserRole } from '../users/entities/user-role.enum';
import {
  CreateProposalVersionDto,
  DeclineProposalDto,
  SendProposalDto,
} from './dto/proposal.dto';
import { FindProposalVersionsQueryDto } from './dto/find-proposal-versions-query.dto';
import { ProposalVersionListResponseDto } from './dto/proposal-version-list-item.dto';
import { ProposalsService } from './proposals.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

function viewerOf(req: AuthRequest): { userId: string; role: UserRole } {
  const userId = req.user?.sub;
  const role = req.user?.role;
  if (!userId || !role) throw new Error('Missing authenticated user context');
  return { userId, role };
}

@ApiTags('Proposals')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProposalsController {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('proposal-versions')
  @Roles(
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.INSTALLER,
    UserRole.EMPLOYEE,
  )
  @ApiOperation({
    summary: 'Cross-job proposal version index',
    description:
      'Backs the web Proposals page. **Admin:** all proposals. **Manager:** only proposals on jobs where `managerId` matches. **Installer/Employee (staff):** only proposals on jobs you are assigned to (`assignedStaffUserId` or an `assignments` row) — the same job-scoping `GET /jobs` and `GET /jobs/:id` already enforce.',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'sentFrom', required: false, description: 'ISO 8601' })
  @ApiQuery({ name: 'sentTo', required: false, description: 'ISO 8601' })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Free text across customer name and job order number',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiOkResponse({ type: ProposalVersionListResponseDto })
  async listAll(
    @Query() query: FindProposalVersionsQueryDto,
    @Req() req: AuthRequest,
  ) {
    const viewer = viewerOf(req);
    const effective = await this.permissions.getEffectiveForUser(viewer.userId);
    this.permissions.assertPermission(effective, 'job:proposal:view');
    return this.proposals.listAll(query, viewer);
  }

  @Get('jobs/:jobId/proposal-versions')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Proposal version history for a job' })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  list(@Param('jobId', ParseUUIDPipe) jobId: string, @Req() req: AuthRequest) {
    return this.proposals.listForJob(jobId, viewerOf(req));
  }

  @Post('jobs/:jobId/proposal-versions')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Create the next proposal version',
    description:
      'Freezes the priced line items and system config. `loan`/`lease` require a term and monthly payment; `ppa` requires a per-kWh rate.',
  })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  create(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: CreateProposalVersionDto,
    @Req() req: AuthRequest,
  ) {
    return this.proposals.createVersion(jobId, dto, viewerOf(req));
  }

  @Post('proposal-versions/:id/send')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Mark a proposal version sent',
    description:
      'Supersedes any other live version for the job, so exactly one proposal is ever open with the customer.',
  })
  @ApiParam({ name: 'id', description: 'Proposal version UUID' })
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendProposalDto,
    @Req() req: AuthRequest,
  ) {
    return this.proposals.send(id, dto, viewerOf(req));
  }

  @Post('proposal-versions/:id/accept')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Accept a proposal version',
    description:
      'Copies the accepted price and deposit onto the job, and supersedes other live versions. Refused once expired.',
  })
  @ApiParam({ name: 'id', description: 'Proposal version UUID' })
  accept(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.proposals.accept(id, viewerOf(req));
  }

  @Post('proposal-versions/:id/decline')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Record a declined proposal' })
  @ApiParam({ name: 'id', description: 'Proposal version UUID' })
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineProposalDto,
    @Req() req: AuthRequest,
  ) {
    return this.proposals.decline(id, dto.reason ?? null, viewerOf(req));
  }

  @Post('proposal-versions/expire-overdue')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Expire proposals past their date (admin)',
    description: 'Runs automatically on the SLA sweep.',
  })
  expireOverdue() {
    return this.proposals.expireOverdue();
  }
}
