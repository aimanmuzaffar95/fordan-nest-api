import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JobListViewer } from '../jobs/jobs.service';
import { PermissionKey } from '../permissions/permission-catalog';
import { PermissionsService } from '../permissions/permissions.service';
import { UserRole } from '../users/entities/user-role.enum';
import { AssignmentsService } from './assignments.service';
import { LockAssignmentDto } from './dto/lock-assignment.dto';

@ApiTags('Assignments')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('assignments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssignmentsLockController {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Post(':id/lock')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Lock or unlock an assignment',
    description:
      '**Lock:** requires non-empty **`reason`**. Writes `assignment_lock_change` to **`timeline_events`**. **Unlock:** optional `reason` (e.g. why reopened). **Installer** cannot call this route.',
  })
  @ApiOkResponse({ description: 'Returns updated assignment in `data`.' })
  @ApiBadRequestResponse({
    description: '**400** — e.g. missing `reason` when `locked: true`.',
  })
  @ApiNotFoundResponse({
    description: 'Assignment not found or job not visible.',
  })
  @ApiForbiddenResponse({
    description: '**403** — `installer` cannot change assignment lock.',
  })
  async setLock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LockAssignmentDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorizeAssignmentAction(req, 'assignment:lock');
    return this.assignments.setLock(id, dto, viewer.userId, viewer);
  }

  private async authorizeAssignmentAction(
    req: Request & { user?: { sub?: string; role?: UserRole } },
    permission: PermissionKey,
  ): Promise<JobListViewer> {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    const effective = await this.permissions.getEffectiveForUser(userId);
    this.permissions.assertPermission(effective, permission);
    return {
      userId,
      role,
      jobScope: effective.scopes.job === 'all' ? 'all' : 'own',
      canViewJobFinancials: this.permissions.hasPermission(
        effective,
        'job:financials:view',
      ),
    };
  }
}
