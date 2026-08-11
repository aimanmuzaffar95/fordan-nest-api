import {
  Body,
  Controller,
  Get,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { AvailabilityService } from './availability.service';
import { PutAvailabilityMeDto } from './dto/put-availability-me.dto';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

@ApiTags('Availability')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('availability')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get('me')
  @Roles(UserRole.INSTALLER)
  @ApiOperation({ summary: 'List my availability windows' })
  listMine(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: AuthRequest,
  ) {
    const userId = req.user?.sub;
    if (!userId) throw new Error('Missing authenticated user context');
    return this.availabilityService.listMine(userId, from, to);
  }

  @Put('me')
  @Roles(UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Replace my future availability from effectiveFrom',
  })
  putMine(@Body() dto: PutAvailabilityMeDto, @Req() req: AuthRequest) {
    const userId = req.user?.sub;
    if (!userId) throw new Error('Missing authenticated user context');
    return this.availabilityService.putMine(userId, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('schedule:view')
  @ApiOperation({ summary: 'List team availability (manager/admin)' })
  listTeam(
    @Query('userId') userId: string | undefined,
    @Query('teamId') teamId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: AuthRequest,
  ) {
    const requesterId = req.user?.sub;
    if (!requesterId) throw new Error('Missing authenticated user context');
    return this.availabilityService.listTeam(
      { userId: requesterId, role: req.user?.role ?? UserRole.MANAGER },
      { userId, teamId, from, to },
    );
  }
}
