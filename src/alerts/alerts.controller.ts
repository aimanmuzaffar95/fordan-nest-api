import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { AlertsService } from './alerts.service';
import {
  AlertResponseDto,
  AlertsListResponseDto,
} from './dto/alert-response.dto';
import { AlertsQueryDto } from './dto/alerts-query.dto';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

@ApiTags('Alerts')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'List alerts',
    description:
      '**Admin:** all alerts. **Manager:** only alerts for jobs where `jobs.managerId = you`.',
  })
  @ApiResponse({ status: 200, type: AlertsListResponseDto })
  findAll(
    @Query() query: AlertsQueryDto,
    @Req() req: AuthRequest,
  ): Promise<AlertsListResponseDto> {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.alertsService.findAlerts(query, { userId, role });
  }

  @Post('evaluate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Trigger alert evaluation (admin only)',
    description: 'Manually triggers the alert rules engine evaluation.',
  })
  @ApiResponse({ status: 201, description: 'Evaluation completed' })
  evaluate(): Promise<{ message: string }> {
    return this.alertsService.evaluateEndpoint();
  }

  @Post('resolve-all')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Resolve all active alerts in scope',
    description:
      '**Admin:** resolves all active alerts. **Manager:** resolves only their own job alerts.',
  })
  @ApiResponse({ status: 201, description: 'Returns count of resolved alerts' })
  resolveAll(@Req() req: AuthRequest): Promise<{ resolved: number }> {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.alertsService.resolveAll({ userId, role });
  }

  @Post(':id/resolve')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Resolve a single alert',
    description:
      '**Manager:** can only resolve alerts for their own jobs. **Admin:** can resolve any alert.',
  })
  @ApiParam({ name: 'id', description: 'Alert UUID' })
  @ApiResponse({ status: 201, type: AlertResponseDto })
  resolve(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ): Promise<AlertResponseDto> {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.alertsService.resolveAlert(id, userId, role);
  }
}
