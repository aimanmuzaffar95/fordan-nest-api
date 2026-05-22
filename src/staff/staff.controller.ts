import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  async listStaff(
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ): Promise<StaffListItem[]> {
    await this.assertStaffPermission(req, 'staff:view');
    return this.staffService.listStaff();
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  async createStaff(
    @Body() dto: CreateStaffDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ): Promise<StaffListItem> {
    await this.assertStaffPermission(req, 'staff:create');
    return this.staffService.createStaff(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  async updateStaff(
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ): Promise<StaffListItem> {
    await this.assertStaffPermission(req, 'staff:update');
    return this.staffService.updateStaff(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  async softDeleteStaff(
    @Param('id') id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ): Promise<{ id: string; deletedAt: string }> {
    await this.assertStaffPermission(req, 'staff:delete');
    return this.staffService.softDeleteStaff(id);
  }

  @Post(':id/reset-password')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  async resetPassword(
    @Param('id') id: string,
    @Req() req: Request & { user?: { sub: string; role: UserRole } },
    @Body() dto: ResetStaffPasswordDto,
  ): Promise<{ staffId: string; username: string; mustChangePassword: true }> {
    const actorUserId = req.user?.sub;
    if (!actorUserId) {
      throw new Error('Missing authenticated user ID');
    }
    await this.assertStaffPermission(req, 'staff:password_reset');
    return this.staffService.resetTemporaryPassword(id, dto, actorUserId);
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
}
