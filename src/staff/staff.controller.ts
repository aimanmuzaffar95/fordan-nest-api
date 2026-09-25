import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionKey } from '../permissions/permission-catalog';
import { PermissionsService } from '../permissions/permissions.service';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateEmployeeRoleDto } from './dto/create-employee-role.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { CreateStaffRoleDto } from './dto/create-staff-role.dto';
import { GrantAdminAccessDto } from './dto/grant-admin-access.dto';
import { ResetStaffPasswordDto } from './dto/reset-staff-password.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffService, StaffListItem } from './staff.service';

type StaffRoleResponse = {
  id: string;
  name: string;
  description: string;
};

type EmployeeRoleResponse = {
  id: string;
  name: string;
  description: string;
};

@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffController {
  constructor(
    private readonly staffService: StaffService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('picker')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  async staffPicker(
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
    @Query('includeAdmins') includeAdmins?: string,
  ) {
    // Lean, PII-free roster for pickers (e.g. mobile assign-crew sheet) —
    // no home address/ID number/phone/email is ever selected, so there is
    // nothing to scrub. Declared above `:id`-shaped routes is unnecessary
    // here (no `GET :id` route exists on this controller) but kept as the
    // safer convention.
    await this.assertStaffPermission(req, 'staff:view');
    return this.staffService.listStaffPicker(includeAdmins === 'true');
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async listStaff(
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
    @Query('includeAdmins') includeAdmins?: string,
  ): Promise<StaffListItem[]> {
    await this.assertStaffPermission(req, 'staff:view');
    const viewerCanSeePii = await this.canViewStaffPii(req);
    return this.staffService.listStaff(
      includeAdmins === 'true',
      viewerCanSeePii,
    );
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async createStaff(
    @Body() dto: CreateStaffDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ): Promise<StaffListItem> {
    await this.assertStaffPermission(req, 'staff:create');
    const viewerCanSeePii = await this.canViewStaffPii(req);
    const actorUserId = req.user?.sub;
    return this.staffService.createStaff(dto, viewerCanSeePii, actorUserId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async updateStaff(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ): Promise<StaffListItem> {
    await this.assertStaffPermission(req, 'staff:update');
    const actorRole = req.user?.role;
    const actorUserId = req.user?.sub;
    if (!actorRole) {
      throw new Error('Missing authenticated user role');
    }
    const viewerCanSeePii = await this.canViewStaffPii(req);
    return this.staffService.updateStaff(
      id,
      dto,
      actorRole,
      actorUserId,
      viewerCanSeePii,
    );
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async softDeleteStaff(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ): Promise<{ id: string; deletedAt: string }> {
    await this.assertStaffPermission(req, 'staff:delete');
    const actorRole = req.user?.role;
    if (!actorRole) {
      throw new Error('Missing authenticated user role');
    }
    const actorUserId = req.user?.sub;
    return this.staffService.softDeleteStaff(id, actorRole, actorUserId);
  }

  @Post(':id/reset-password')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub: string; role: UserRole } },
    @Body() dto: ResetStaffPasswordDto,
  ): Promise<{ staffId: string; username: string; mustChangePassword: true }> {
    const actorUserId = req.user?.sub;
    const actorRole = req.user?.role;
    if (!actorUserId || !actorRole) {
      throw new Error('Missing authenticated user context');
    }
    await this.assertStaffPermission(req, 'staff:password_reset');
    return this.staffService.resetTemporaryPassword(
      id,
      dto,
      actorUserId,
      actorRole,
    );
  }

  /**
   * Temporary admin access for a manager. Real admins only: a manager who is
   * currently elevated carries `role: admin` in the request but must not be
   * able to extend their own grant or elevate peers (`elevated` flag).
   */
  @Put(':id/admin-access')
  @Roles(UserRole.ADMIN)
  async grantAdminAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantAdminAccessDto,
    @Req() req: Request & { user?: { sub?: string; elevated?: boolean } },
  ): Promise<StaffListItem> {
    const actorUserId = this.assertRealAdmin(req);
    return this.staffService.setTemporaryAdmin(
      id,
      new Date(dto.until),
      actorUserId,
    );
  }

  @Delete(':id/admin-access')
  @Roles(UserRole.ADMIN)
  async revokeAdminAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; elevated?: boolean } },
  ): Promise<StaffListItem> {
    const actorUserId = this.assertRealAdmin(req);
    return this.staffService.setTemporaryAdmin(id, null, actorUserId);
  }

  private assertRealAdmin(
    req: Request & { user?: { sub?: string; elevated?: boolean } },
  ): string {
    const actorUserId = req.user?.sub;
    if (!actorUserId) {
      throw new Error('Missing authenticated user context');
    }
    if (req.user?.elevated) {
      throw new ForbiddenException(
        'Temporary admin access cannot be granted by a temporarily elevated account',
      );
    }
    return actorUserId;
  }

  @Get('roles')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  async listRoles(
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ): Promise<StaffRoleResponse[]> {
    await this.assertStaffPermission(req, 'staff_role:view');
    return this.staffService.listRoles();
  }

  @Post('roles')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  async createRole(
    @Body() dto: CreateStaffRoleDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ): Promise<StaffRoleResponse> {
    await this.assertStaffPermission(req, 'staff_role:manage');
    return this.staffService.createRole(dto);
  }

  @Get('employee-roles')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  async listEmployeeRoles(
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ): Promise<EmployeeRoleResponse[]> {
    await this.assertStaffPermission(req, 'employee_role:view');
    return this.staffService.listEmployeeRoles();
  }

  @Post('employee-roles')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  async createEmployeeRole(
    @Body() dto: CreateEmployeeRoleDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ): Promise<EmployeeRoleResponse> {
    await this.assertStaffPermission(req, 'employee_role:manage');
    return this.staffService.createEmployeeRole(dto);
  }

  private async assertStaffPermission(
    req: Request & { user?: { sub?: string; role?: UserRole } },
    permission: PermissionKey,
  ): Promise<void> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }
    const effective = await this.permissions.getEffectiveForUser(userId);
    this.permissions.assertPermission(effective, permission);
  }

  /**
   * Staff PII visibility (home address/ID number/phone/email) is keyed on
   * the `staff:pii:view` permission, not on raw role, so per-user overrides
   * can actually reach it — a role-keyed check (the previous
   * `role === UserRole.ADMIN` gate) is invisible to the override layer and
   * can never be delegated or audited. ADMIN holds every key by default
   * (see DEFAULT_PERMISSIONS_BY_ROLE), so this preserves the existing
   * "only ADMIN sees staff PII" default behaviour while making it
   * overridable/auditable like every other field-level key.
   */
  private async canViewStaffPii(
    req: Request & { user?: { sub?: string; role?: UserRole } },
  ): Promise<boolean> {
    const userId = req.user?.sub;
    if (!userId) {
      return false;
    }
    const effective = await this.permissions.getEffectiveForUser(userId);
    return this.permissions.hasPermission(effective, 'staff:pii:view');
  }
}
