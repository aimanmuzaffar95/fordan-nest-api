import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
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
  @Roles(UserRole.MANAGER, UserRole.INSTALLER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Get current installer employee form' })
  getMine(
    @Req() req: Request & { user?: { sub?: string } },
  ): Promise<EmployeeFormResponse | null> {
    return this.employeeFormsService.getForUser(req.user?.sub ?? '');
  }

  @Put('me')
  @Roles(UserRole.MANAGER, UserRole.INSTALLER, UserRole.EMPLOYEE)
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

  @Put('user/:userId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      'Create or replace a staff member’s onboarding form (admin/manager)',
    description:
      'For filling the form on someone’s behalf — over the phone, or from paper. Works whether or not they have submitted one already; `PATCH :id` only edits an existing submission.',
  })
  @ApiParam({ name: 'userId', description: 'Staff member user UUID' })
  upsertForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpsertEmployeeFormDto,
  ) {
    return this.employeeFormsService.upsertForUser(userId, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a submitted employee form as admin' })
  updateByAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertEmployeeFormDto,
  ): Promise<EmployeeFormResponse> {
    return this.employeeFormsService.updateByAdmin(id, dto);
  }
}
