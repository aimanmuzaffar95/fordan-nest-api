import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminOnly } from '../auth/decorators/role-access.decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { ClonePermissionRoleDto } from './dto/clone-permission-role.dto';
import { CreatePermissionRoleDto } from './dto/create-permission-role.dto';
import { RenamePermissionRoleDto } from './dto/rename-permission-role.dto';
import { UpdatePermissionRoleDto } from './dto/update-permission-role.dto';
import { RequirePermission } from './decorators/require-permission.decorator';
import { PermissionsGuard } from './guards/permissions.guard';
import { PermissionsService } from './permissions.service';

@ApiTags('Permissions')
@ApiBearerAuth('JWT')
@Controller('permissions')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user effective permissions' })
  me(@Req() req: Request & { user?: { sub?: string; role?: UserRole } }) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.permissions.getEffectiveForUser(userId);
  }

  @Get('catalog')
  @AdminOnly()
  @ApiOperation({ summary: 'Permission catalog for admin UI' })
  catalog() {
    return this.permissions.getCatalog();
  }

  @Get('roles')
  @AdminOnly()
  @ApiOperation({ summary: 'List editable role permission profiles' })
  roles() {
    return this.permissions.listProfiles();
  }

  @Get('roles/:id')
  @AdminOnly()
  @ApiOperation({ summary: 'Get role permission profile' })
  role(@Param('id') id: string) {
    return this.permissions.getProfile(id);
  }

  @Post('roles')
  @RequirePermission('permission_role:author')
  @ApiOperation({
    summary:
      'Author a new custom role, optionally cloning grants/scopes from an existing profile',
  })
  createRole(
    @Body() dto: CreatePermissionRoleDto,
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    const actorUserId = req.user?.sub;
    if (!actorUserId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.permissions.createRole(dto, actorUserId);
  }

  @Post('roles/:id/clone')
  @RequirePermission('permission_role:author')
  @ApiOperation({ summary: 'Clone an existing role into a new custom role' })
  cloneRole(
    @Param('id') id: string,
    @Body() dto: ClonePermissionRoleDto,
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    const actorUserId = req.user?.sub;
    if (!actorUserId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.permissions.cloneRole(id, dto.name, actorUserId, dto.family);
  }

  @Patch('roles/:id')
  @RequirePermission('permission_role:author')
  @ApiOperation({ summary: 'Rename/redescribe a custom role' })
  renameRole(
    @Param('id') id: string,
    @Body() dto: RenamePermissionRoleDto,
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    const actorUserId = req.user?.sub;
    if (!actorUserId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.permissions.renameRole(id, dto, actorUserId);
  }

  @Delete('roles/:id')
  @RequirePermission('permission_role:author')
  @ApiOperation({
    summary: 'Delete a custom role (blocked while staff are still assigned to it)',
  })
  deleteRole(
    @Param('id') id: string,
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    const actorUserId = req.user?.sub;
    if (!actorUserId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.permissions.deleteRole(id, actorUserId);
  }

  @Put('roles/:id')
  @RequirePermission('permission_role:author')
  @ApiOperation({ summary: 'Replace role permission profile grants/scopes' })
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdatePermissionRoleDto,
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    const actorUserId = req.user?.sub;
    if (!actorUserId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.permissions.updateProfile(id, dto, actorUserId);
  }

  @Post('roles/:id/reset')
  @RequirePermission('permission_role:author')
  @ApiOperation({ summary: 'Reset role permission profile to defaults' })
  resetRole(
    @Param('id') id: string,
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    const actorUserId = req.user?.sub;
    if (!actorUserId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.permissions.resetProfile(id, actorUserId);
  }

  @Get('overrides/:userId')
  @RequirePermission('staff:override:manage')
  @ApiOperation({ summary: 'List a user\'s per-user permission overrides' })
  listOverrides(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.permissions.listOverrides(userId);
  }

  @Put('overrides/:userId')
  @RequirePermission('staff:override:manage')
  @ApiOperation({
    summary: 'Set a per-user permission override (delegation, audited)',
  })
  setOverride(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: { permissionKey: string; enabled: boolean },
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    const actorUserId = req.user?.sub;
    if (!actorUserId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.permissions.setOverride(
      userId,
      dto.permissionKey,
      dto.enabled,
      actorUserId,
    );
  }

  @Delete('overrides/:userId/:permissionKey')
  @RequirePermission('staff:override:manage')
  @ApiOperation({ summary: 'Clear a per-user permission override' })
  clearOverride(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('permissionKey') permissionKey: string,
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    const actorUserId = req.user?.sub;
    if (!actorUserId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.permissions.setOverride(
      userId,
      permissionKey,
      null,
      actorUserId,
    );
  }

  @Delete('overrides/:userId')
  @RequirePermission('staff:override:manage')
  @ApiOperation({
    summary: 'Discard every per-user override and fall back to the role profile',
    description:
      'The "push the role down" action — deletes all of this user\'s per-user overrides in one call so their effective permissions reduce to exactly their role profile. Also runs automatically when a staff member\'s role changes.',
  })
  clearAllOverrides(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    const actorUserId = req.user?.sub;
    if (!actorUserId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.permissions.clearOverridesForUser(userId, actorUserId);
  }
}
