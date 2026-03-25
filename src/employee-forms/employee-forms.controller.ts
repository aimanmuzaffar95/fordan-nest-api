import { Body, Controller, Get, Param, Patch, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import {
  EmployeeFormsService,
  EmployeeFormResponse,
} from './employee-forms.service';
import { UpsertEmployeeFormDto } from './dto/upsert-employee-form.dto';

@ApiTags('Employee Forms')
@ApiBearerAuth('JWT')
@Controller('employee-forms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeeFormsController {
  constructor(private readonly employeeFormsService: EmployeeFormsService) {}

  @Get('me')
  @Roles(UserRole.INSTALLER)
  @ApiOperation({ summary: 'Get current installer employee form' })
  getMine(
    @Req() req: Request & { user?: { sub?: string } },
  ): Promise<EmployeeFormResponse | null> {
    return this.employeeFormsService.getForUser(req.user?.sub ?? '');
  }

  @Put('me')
  @Roles(UserRole.INSTALLER)
  @ApiOperation({ summary: 'Create current installer employee form' })
  upsertMine(
    @Req() req: Request & { user?: { sub?: string } },
    @Body() dto: UpsertEmployeeFormDto,
  ): Promise<EmployeeFormResponse> {
    return this.employeeFormsService.upsertForUser(req.user?.sub ?? '', dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'List submitted employee forms' })
  list(): Promise<EmployeeFormResponse[]> {
    return this.employeeFormsService.list();
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a submitted employee form as admin' })
  updateByAdmin(
    @Param('id') id: string,
    @Body() dto: UpsertEmployeeFormDto,
  ): Promise<EmployeeFormResponse> {
    return this.employeeFormsService.updateByAdmin(id, dto);
  }
}
