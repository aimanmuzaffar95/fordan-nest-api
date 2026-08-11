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
  ApiResponse,
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
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskResponseDto, TasksListResponseDto } from './dto/task-response.dto';
import { TasksQueryDto } from './dto/tasks-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

const ALL_ROLES = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.INSTALLER,
  UserRole.EMPLOYEE,
] as const;

function viewerOf(req: AuthRequest): { userId: string; role: UserRole } {
  const userId = req.user?.sub;
  const role = req.user?.role;
  if (!userId || !role) {
    throw new Error('Missing authenticated user context');
  }
  return { userId, role };
}

@ApiTags('Tasks')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @Roles(...ALL_ROLES)
  @RequirePermission('task:view')
  @ApiOperation({
    summary: 'List tasks',
    description:
      '**Admin:** everything (`scope=all` default). **Manager:** managed-job tasks plus their own. **Installer/employee:** always their own assigned tasks.',
  })
  @ApiResponse({ status: 200, type: TasksListResponseDto })
  findAll(
    @Query() query: TasksQueryDto,
    @Req() req: AuthRequest,
  ): Promise<TasksListResponseDto> {
    return this.tasks.findAll(query, viewerOf(req));
  }

  @Post()
  @Roles(...ALL_ROLES)
  @RequirePermission('task:manage')
  @ApiOperation({
    summary: 'Create a task',
    description:
      'Non-privileged users may only create tasks on jobs assigned to them, and only assigned to themselves.',
  })
  @ApiResponse({ status: 201, type: TaskResponseDto })
  create(
    @Body() dto: CreateTaskDto,
    @Req() req: AuthRequest,
  ): Promise<TaskResponseDto> {
    return this.tasks.create(dto, viewerOf(req));
  }

  @Post('sweep-sla')
  @Roles(UserRole.ADMIN)
  @RequirePermission('task:manage')
  @ApiOperation({
    summary: 'Run the SLA sweep now (admin only)',
    description:
      'Flags newly-breached SLAs and escalates overdue tasks. Runs automatically every 10 minutes.',
  })
  sweepSla(): Promise<{ breached: number; escalated: number }> {
    return this.tasks.sweepSlas();
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  @RequirePermission('task:view')
  @ApiOperation({ summary: 'Get a task' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, type: TaskResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ): Promise<TaskResponseDto> {
    return this.tasks.findOne(id, viewerOf(req));
  }

  @Patch(':id')
  @Roles(...ALL_ROLES)
  @RequirePermission('task:manage')
  @ApiOperation({
    summary: 'Update a task',
    description:
      'Assignees who are not admin/manager may only change `status`; every other field is admin/manager-only.',
  })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, type: TaskResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @Req() req: AuthRequest,
  ): Promise<TaskResponseDto> {
    return this.tasks.update(id, dto, viewerOf(req));
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('task:manage')
  @ApiOperation({ summary: 'Delete a task (admin/manager)' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ): Promise<{ deleted: true }> {
    return this.tasks.remove(id, viewerOf(req));
  }
}
