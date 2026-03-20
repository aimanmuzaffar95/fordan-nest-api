import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { UpdateMeterApplicationDto } from './dto/update-meter-application.dto';
import { MeterApplicationsService } from './meter-applications.service';

@ApiTags('Metering')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('meter-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeterApplicationsController {
  constructor(private readonly meters: MeterApplicationsService) {}

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Update meter application status',
    description:
      '**Admin/manager only.** Sets **`pending`**, **`approved`**, or **`rejected`**. When **`rejected`**, **`rejectionReason`** must be a non-empty string. Writes **`meter_status_change`** on the job timeline.',
  })
  @ApiNotFoundResponse({ description: 'Unknown meter application id.' })
  @ApiForbiddenResponse({ description: 'Installer or other disallowed role.' })
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMeterApplicationDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    if (!req.user?.role || !userId) {
      throw new Error('Missing authenticated user context');
    }
    return this.meters.updateStatus(id, dto, userId);
  }
}
