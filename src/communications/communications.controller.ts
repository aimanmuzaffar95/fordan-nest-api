import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CommunicationsService } from './communications.service';
import {
  LogCommunicationDto,
  UpdateCommunicationStatusDto,
} from './dto/communication.dto';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

function viewerOf(req: AuthRequest): { userId: string; role: UserRole } {
  const userId = req.user?.sub;
  const role = req.user?.role;
  if (!userId || !role) throw new Error('Missing authenticated user context');
  return { userId, role };
}

@ApiTags('Communications')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommunicationsController {
  constructor(private readonly communications: CommunicationsService) {}

  @Get('customers/:customerId/communications')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'SMS, calls and logged conversations for a customer',
  })
  @ApiParam({ name: 'customerId', description: 'Customer UUID' })
  list(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Req() req: AuthRequest,
  ) {
    return this.communications.listForCustomer(customerId, viewerOf(req));
  }

  @Post('communications')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Log a communication',
    description:
      'Mirrored into the job timeline when `jobId` is supplied, so SMS and calls sit alongside the email history.',
  })
  log(@Body() dto: LogCommunicationDto, @Req() req: AuthRequest) {
    return this.communications.log(dto, viewerOf(req));
  }

  @Patch('communications/:id/status')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Update delivery status',
    description: 'For provider webhooks and manual reconciliation.',
  })
  @ApiParam({ name: 'id', description: 'Communication UUID' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommunicationStatusDto,
    @Req() req: AuthRequest,
  ) {
    return this.communications.updateStatus(
      id,
      dto.status,
      dto.failureReason ?? null,
      viewerOf(req),
    );
  }
}
