import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { UserRole } from '../users/entities/user-role.enum';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';

/**
 * Routes live under `/jobs` next to {@link JobsController} (separate module to avoid circular imports).
 */
@ApiTags('Assignments')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class JobAssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get(':jobId/assignments')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'List assignments for a job',
    description:
      '**Installer:** same job visibility as **`GET /jobs/:id`** (**404** if not assigned to you).',
  })
  @ApiNotFoundResponse({ description: 'Job not found or not visible.' })
  list(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.assignments.listForJob(jobId, { userId, role });
  }

  @Post(':jobId/assignments')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Create schedule assignment for a job',
    description:
      '**One assignment per job** (delete first to reschedule). Enforces **team daily kW** (`teams.dailyCapacityKw`) for all jobs on that team **date** (sum of `jobs.systemSizeKw`) and **DB unique** `(staffUserId, scheduledDate, slot)`. Updates job denormalized schedule fields + `installDate`.',
  })
  @ApiCreatedResponse({ description: 'Assignment created (**201**).' })
  @ApiConflictResponse({
    description:
      '**409** + `code: CONFLICT` — capacity, double-booked staff, inactive user, or job already scheduled.',
  })
  @ApiForbiddenResponse({
    description: '**403** — `installer` cannot create assignments.',
  })
  @ApiNotFoundResponse({ description: 'Job, team, or staff user not found.' })
  create(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: CreateAssignmentDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.assignments.create(jobId, dto, { userId, role });
  }

  @Delete(':jobId/assignments/:assignmentId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Delete an assignment',
    description:
      'Clears job denormalized `assignedTeamId`, `assignedStaffUserId`, `scheduledDate`, `scheduledSlot`, and `installDate`. **409** if the assignment is **locked** — call **`POST /assignments/:id/lock`** with `locked: false` first.',
  })
  @ApiOkResponse({ description: '`data: { id }` of removed assignment.' })
  @ApiConflictResponse({
    description: '**409** — assignment is locked.',
  })
  @ApiNotFoundResponse({ description: 'Job or assignment not found.' })
  @ApiForbiddenResponse({
    description: '**403** — `installer` cannot delete assignments.',
  })
  remove(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.assignments.remove(jobId, assignmentId, { userId, role });
  }
}
