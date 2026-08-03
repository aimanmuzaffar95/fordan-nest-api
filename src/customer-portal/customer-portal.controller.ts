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
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CustomerPortalService } from './customer-portal.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

function viewerOf(req: AuthRequest): { userId: string; role: UserRole } {
  const userId = req.user?.sub;
  const role = req.user?.role;
  if (!userId || !role) throw new Error('Missing authenticated user context');
  return { userId, role };
}

export class IssuePortalTokenDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  ttlDays?: number;
}

/** Staff-side portal link management. */
@ApiTags('Customer portal')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerPortalAdminController {
  constructor(private readonly portal: CustomerPortalService) {}

  @Post(':jobId/portal-link')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Issue a customer portal link for a job',
    description:
      'Returns the plaintext token exactly once — only its hash is stored, so it can never be retrieved again. Scoped to this one job.',
  })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  issue(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: IssuePortalTokenDto,
    @Req() req: AuthRequest,
  ) {
    return this.portal.issueToken(jobId, viewerOf(req), dto.ttlDays);
  }

  @Post(':jobId/portal-link/revoke')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Revoke every live portal link for a job' })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  revoke(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: AuthRequest,
  ) {
    return this.portal.revokeAllForJob(jobId, viewerOf(req));
  }
}

/**
 * The public, unauthenticated portal surface.
 *
 * Throttled, and every failure returns the same 404 so the endpoint cannot be
 * used to enumerate valid tokens.
 */
@ApiTags('Customer portal (public)')
@Controller('public/portal')
export class CustomerPortalPublicController {
  constructor(private readonly portal: CustomerPortalService) {}

  @Get('status')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Customer-facing job status for a portal token',
    description:
      'No authentication. Returns a deliberately coarse, plain-language view — no pricing, staff names, or internal stage names.',
  })
  status(@Query('token') token: string) {
    return this.portal.statusForToken(token ?? '');
  }
}
