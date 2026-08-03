import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
import { UserRole } from '../users/entities/user-role.enum';
import {
  CreateProposalVersionDto,
  DeclineProposalDto,
  SendProposalDto,
} from './dto/proposal.dto';
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
  constructor(private readonly proposals: ProposalsService) {}

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
