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
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { AvailabilityService } from './availability.service';
import {
  ListAdminAvailabilityQueryDto,
  ListMyAvailabilityQueryDto,
} from './dto/list-availability-query.dto';
import { PutAvailabilityDto } from './dto/put-availability.dto';

@ApiTags('Availability')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('availability')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get('me')
  @Roles(UserRole.INSTALLER)
  @ApiOperation({ summary: 'List own availability windows' })
  listMine(
    @Query() query: ListMyAvailabilityQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }
    return this.availability.listMine(userId, query);
  }

  @Put('me')
  @Roles(UserRole.INSTALLER)
  @ApiOperation({ summary: 'Replace future availability from effectiveFrom' })
  putMine(
    @Body() dto: PutAvailabilityDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }
    return this.availability.putMine(userId, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'List staff schedules (manager scoped)' })
  listAdmin(
    @Query() query: ListAdminAvailabilityQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.availability.listAdmin(userId, role, query);
  }
}
