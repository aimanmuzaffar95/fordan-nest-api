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
import {
  CreateFinancingApplicationDto,
  UpdateFinancingApplicationDto,
} from './dto/financing.dto';
import { FinancingService } from './financing.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

function viewerOf(req: AuthRequest): { userId: string; role: UserRole } {
  const userId = req.user?.sub;
  const role = req.user?.role;
  if (!userId || !role) throw new Error('Missing authenticated user context');
  return { userId, role };
}

@ApiTags('Financing')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinancingController {
  constructor(private readonly financing: FinancingService) {}

  @Get('jobs/:jobId/financing')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Financing applications for a job' })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  list(@Param('jobId', ParseUUIDPipe) jobId: string, @Req() req: AuthRequest) {
    return this.financing.listForJob(jobId, viewerOf(req));
  }

  @Post('jobs/:jobId/financing')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Start a financing application',
    description: 'Created in `intent`; move it along with PATCH.',
  })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  create(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: CreateFinancingApplicationDto,
    @Req() req: AuthRequest,
  ) {
    return this.financing.create(jobId, dto, viewerOf(req));
  }

  @Post('financing/sweep-expiries')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Warn on and expire lapsed approvals (admin)',
    description: 'Runs automatically on the SLA sweep.',
  })
  sweep() {
    return this.financing.sweepExpiries();
  }

  @Patch('financing/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Update a financing application',
    description:
      'Status transitions are validated — a declined or settled application is terminal.',
  })
  @ApiParam({ name: 'id', description: 'Financing application UUID' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinancingApplicationDto,
    @Req() req: AuthRequest,
  ) {
    return this.financing.update(id, dto, viewerOf(req));
  }
}
