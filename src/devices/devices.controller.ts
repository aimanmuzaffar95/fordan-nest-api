import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

@ApiTags('Devices')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('devices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register device for push notifications' })
  register(@Body() dto: RegisterDeviceDto, @Req() req: AuthRequest) {
    const userId = req.user?.sub;
    if (!userId) throw new Error('Missing authenticated user context');
    return this.devicesService.register(userId, dto);
  }
}
