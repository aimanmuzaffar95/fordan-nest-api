import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { OrganizationProfileService } from './organization-profile.service';
import { UpdateOrganizationProfileDto } from './dto/update-organization-profile.dto';

@ApiTags('Organization')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('organization-profile')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationProfileController {
  constructor(private readonly organization: OrganizationProfileService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Get organization profile',
    description:
      'Returns the singleton organization record used for documents, tax, and regional defaults. Readable by admin and manager.',
  })
  getProfile() {
    return this.organization.getProfile();
  }

  @Patch()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update organization profile',
    description:
      'Admin-only partial update. Writes an append-only system audit event listing changed field keys.',
  })
  updateProfile(
    @Body() dto: UpdateOrganizationProfileDto,
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }
    return this.organization.updateProfile(dto, userId);
  }
}
