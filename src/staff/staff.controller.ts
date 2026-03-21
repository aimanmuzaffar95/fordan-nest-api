import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminOnly } from '../auth/decorators/role-access.decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateStaffDto } from './dto/create-staff.dto';
import { CreateStaffRoleDto } from './dto/create-staff-role.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffService, StaffListItem } from './staff.service';

type StaffRoleResponse = {
  id: string;
  name: string;
  description: string;
};

@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  listStaff(): Promise<StaffListItem[]> {
    return this.staffService.listStaff();
  }

  @Post()
  @AdminOnly()
  createStaff(@Body() dto: CreateStaffDto): Promise<StaffListItem> {
    return this.staffService.createStaff(dto);
  }

  @Patch(':id')
  @AdminOnly()
  updateStaff(
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ): Promise<StaffListItem> {
    return this.staffService.updateStaff(id, dto);
  }

  @Delete(':id')
  @AdminOnly()
  softDeleteStaff(
    @Param('id') id: string,
  ): Promise<{ id: string; deletedAt: string }> {
    return this.staffService.softDeleteStaff(id);
  }

  @Get('roles')
  listRoles(): Promise<StaffRoleResponse[]> {
    return this.staffService.listRoles();
  }

  @Post('roles')
  @AdminOnly()
  createRole(@Body() dto: CreateStaffRoleDto): Promise<StaffRoleResponse> {
    return this.staffService.createRole(dto);
  }
}
