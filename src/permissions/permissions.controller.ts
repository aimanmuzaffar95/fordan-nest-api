import {
  Body,
  Controller,
  Get,
  Param,
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
import { UpdatePermissionRoleDto } from './dto/update-permission-role.dto';
import { PermissionsService } from './permissions.service';

@ApiTags('Permissions')
@ApiBearerAuth('JWT')
@Controller('permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
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

  @Put('roles/:id')
  @AdminOnly()
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
  @AdminOnly()
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
}
