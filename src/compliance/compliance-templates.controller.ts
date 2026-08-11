import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { ComplianceService } from './compliance.service';
import {
  CreateComplianceTemplateDto,
  UpdateComplianceTemplateDto,
} from './dto/compliance-field.dto';

@ApiTags('Compliance templates')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('compliance/templates')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class ComplianceTemplatesController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @RequirePermission('compliance:template:view')
  @ApiOperation({
    summary: 'List compliance form templates',
    description:
      '**Admin** may pass `?all=1` to include inactive templates. Managers and installers only receive active templates.',
  })
  list(
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
    @Query('all') all?: string,
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    const includeInactive = role === UserRole.ADMIN && all === '1';
    return this.compliance.listTemplates({ userId, role }, includeInactive);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @RequirePermission('compliance:template:manage')
  @ApiOperation({ summary: 'Create a compliance template (admin only)' })
  create(@Body() dto: CreateComplianceTemplateDto) {
    return this.compliance.createTemplate(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermission('compliance:template:manage')
  @ApiOperation({ summary: 'Update a compliance template (admin only)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateComplianceTemplateDto,
  ) {
    return this.compliance.updateTemplate(id, dto);
  }
}
