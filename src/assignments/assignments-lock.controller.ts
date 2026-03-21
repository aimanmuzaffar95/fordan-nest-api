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
  constructor(private readonly assignments: AssignmentsService) {}

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
  setLock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LockAssignmentDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.assignments.setLock(id, dto, userId, { userId, role });
  }
}
