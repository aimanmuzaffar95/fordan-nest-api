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
import { PermissionsService } from '../permissions/permissions.service';
import { UserRole } from '../users/entities/user-role.enum';
import {
  CreateTrainingModuleDto,
  ListTrainingModulesQueryDto,
  SubmitTrainingAttemptDto,
  TrainingProgressQueryDto,
  UpdateTrainingModuleDto,
} from './dto/training.dto';
import { TrainingService, Viewer } from './training.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

const ALL_ROLES = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.INSTALLER,
  UserRole.EMPLOYEE,
] as const;
const MANAGE_ROLES = [UserRole.ADMIN, UserRole.MANAGER] as const;

@ApiTags('Training')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('training')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class TrainingController {
  constructor(
    private readonly training: TrainingService,
    private readonly permissions: PermissionsService,
  ) {}

  private actorOf(req: AuthRequest): string {
    const id = req.user?.sub;
    if (!id) throw new Error('Missing authenticated user context');
    return id;
  }

  /** `correctIndex` is only ever revealed to callers holding training:manage. */
  private async viewerOf(req: AuthRequest): Promise<Viewer> {
    const userId = this.actorOf(req);
    const role = req.user?.role;
    if (!role) throw new Error('Missing authenticated user context');
    const effective = await this.permissions.getEffectiveForUser(userId);
    return {
      userId,
      role,
      canManage: this.permissions.hasPermission(effective, 'training:manage'),
    };
  }

  @Get('modules')
  @Roles(...MANAGE_ROLES)
  @RequirePermission('training:manage')
  @ApiOperation({ summary: 'List all training modules (with answers)' })
  list(@Query() q: ListTrainingModulesQueryDto) {
    return this.training.listAll(q.active);
  }

  @Post('modules')
  @Roles(...MANAGE_ROLES)
  @RequirePermission('training:manage')
  @ApiOperation({ summary: 'Create a training module' })
  create(@Body() dto: CreateTrainingModuleDto, @Req() req: AuthRequest) {
    return this.training.create(dto, this.actorOf(req));
  }

  @Get('me')
  @Roles(...ALL_ROLES)
  @RequirePermission('training:view')
  @ApiOperation({ summary: 'My applicable modules and progress' })
  async me(@Req() req: AuthRequest) {
    return this.training.me(await this.viewerOf(req));
  }

  @Get('progress')
  @Roles(...MANAGE_ROLES)
  @RequirePermission('training:manage')
  @ApiOperation({ summary: 'Per-staff training progress' })
  progress(@Query() q: TrainingProgressQueryDto) {
    return this.training.progress(q.userId);
  }

  @Get('modules/:id')
  @Roles(...ALL_ROLES)
  @RequirePermission('training:view')
  @ApiOperation({ summary: 'One module for taking the quiz' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.training.getOne(id, await this.viewerOf(req));
  }

  @Patch('modules/:id')
  @Roles(...MANAGE_ROLES)
  @RequirePermission('training:manage')
  @ApiOperation({ summary: 'Update a module (questions replace the set)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTrainingModuleDto,
    @Req() req: AuthRequest,
  ) {
    return this.training.update(id, dto, this.actorOf(req));
  }

  @Delete('modules/:id')
  @Roles(...MANAGE_ROLES)
  @RequirePermission('training:manage')
  @ApiOperation({ summary: 'Hard-delete a module' })
  @ApiParam({ name: 'id', format: 'uuid' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.training.remove(id, this.actorOf(req));
  }

  @Post('modules/:id/attempts')
  @Roles(...ALL_ROLES)
  @RequirePermission('training:view')
  @ApiOperation({ summary: 'Submit quiz answers' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async attempt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitTrainingAttemptDto,
    @Req() req: AuthRequest,
  ) {
    return this.training.submitAttempt(
      id,
      dto.answers,
      await this.viewerOf(req),
    );
  }
}
