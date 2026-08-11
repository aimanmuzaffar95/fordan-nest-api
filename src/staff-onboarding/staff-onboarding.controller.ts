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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { UpsertEmployeeFormDto } from '../employee-forms/dto/upsert-employee-form.dto';
import { CreateOnboardingInviteDto } from './dto/staff-onboarding.dto';
import { StaffOnboardingService } from './staff-onboarding.service';
import { StaffOnboardingAcceptService } from './staff-onboarding-accept.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

function actorOf(req: AuthRequest): string {
  const userId = req.user?.sub;
  if (!userId) throw new Error('Missing authenticated user context');
  return userId;
}

@ApiTags('Staff onboarding')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('staff/onboarding-invites')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class StaffOnboardingController {
  constructor(private readonly onboarding: StaffOnboardingService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('staff:view')
  @ApiOperation({ summary: 'List onboarding invites and their status' })
  list() {
    return this.onboarding.list();
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('staff:create')
  @ApiOperation({
    summary: 'Invite someone to complete their onboarding form',
    description:
      'Supply `userId` for an existing staff member, or an email plus role for a new hire whose account is created when they submit. Emails the link and returns it once — only the hash is stored. Any previous pending invite for the same person is revoked.',
  })
  invite(@Body() dto: CreateOnboardingInviteDto, @Req() req: AuthRequest) {
    return this.onboarding.invite(dto, actorOf(req));
  }

  @Post(':id/resend')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('staff:create')
  @ApiOperation({
    summary: 'Resend an invite',
    description:
      'Mints a fresh token — the stored hash cannot be reversed — which retires the previous link.',
  })
  @ApiParam({ name: 'id', description: 'Invite UUID' })
  resend(@Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.resend(id);
  }

  @Post(':id/revoke')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('staff:create')
  @ApiOperation({ summary: 'Revoke an invite so its link stops working' })
  @ApiParam({ name: 'id', description: 'Invite UUID' })
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.revoke(id);
  }
}

/**
 * The public, unauthenticated onboarding surface.
 *
 * Throttled and mounted with `ThrottlerGuard` — there is no global APP_GUARD in
 * this app, so `@Throttle` alone would be inert. Every failure returns the same
 * 404 so the endpoint cannot be used to discover valid tokens.
 */
@ApiTags('Staff onboarding (public)')
@Controller('public/onboarding')
@UseGuards(ThrottlerGuard)
export class StaffOnboardingPublicController {
  constructor(
    private readonly onboarding: StaffOnboardingService,
    private readonly accept: StaffOnboardingAcceptService,
  ) {}

  @Get(':token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'What the invite is for, plus anything worth pre-filling',
    description:
      'No authentication. Returns only the invitee’s own name and email — never other staff, and never credentials.',
  })
  @ApiParam({ name: 'token', description: 'Invite token from the email' })
  async describe(@Param('token') token: string) {
    const invite = await this.onboarding.resolveToken(token);
    return {
      email: invite.email,
      firstName: invite.firstName,
      lastName: invite.lastName,
      role: invite.intendedRole,
      isNewAccount: invite.userId === null,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  @Post(':token')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Submit the onboarding form',
    description:
      'Creates the staff account first when the invite was for a new hire, using the role fixed at invite time. Single use — the invite is spent on success.',
  })
  @ApiParam({ name: 'token', description: 'Invite token from the email' })
  submit(@Param('token') token: string, @Body() dto: UpsertEmployeeFormDto) {
    return this.accept.acceptInvite(token, dto);
  }
}
