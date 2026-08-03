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
import { CommissionService } from './commission.service';
import {
  CommissionQueryDto,
  CreateCommissionEventDto,
  RecordPayoutDto,
  UpdateCommissionEventDto,
} from './dto/commission.dto';
import { CommissionStatus } from './entities/commission-event.entity';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

function viewerOf(req: AuthRequest): { userId: string; role: UserRole } {
  const userId = req.user?.sub;
  const role = req.user?.role;
  if (!userId || !role) throw new Error('Missing authenticated user context');
  return { userId, role };
}

@ApiTags('Commission')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('commission')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommissionController {
  constructor(private readonly commission: CommissionService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'List commission records',
    description:
      'Admins see everyone; everyone else is limited to their own records.',
  })
  list(@Query() query: CommissionQueryDto, @Req() req: AuthRequest) {
    return this.commission.list(query, viewerOf(req));
  }

  @Get('me')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({ summary: 'Your own commission summary' })
  mySummary(@Req() req: AuthRequest) {
    const viewer = viewerOf(req);
    return this.commission.summary(viewer.userId, viewer);
  }

  @Get('export')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Flat rows for an accounting export (admin)',
  })
  export(
    @Query('status') status: CommissionStatus | undefined,
    @Query('payoutReference') payoutReference: string | undefined,
    @Req() req: AuthRequest,
  ) {
    return this.commission.exportRows(
      { status, payoutReference },
      viewerOf(req),
    );
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create a commission record (admin)',
    description:
      'Created `pending`. Rate-based entries must record the basis they were applied to.',
  })
  create(@Body() dto: CreateCommissionEventDto, @Req() req: AuthRequest) {
    return this.commission.create(dto, viewerOf(req));
  }

  @Post('payouts')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Record a payout run (admin)',
    description:
      'Marks the selected approved records paid under one reference. Refuses if any record is not approved.',
  })
  recordPayout(@Body() dto: RecordPayoutDto, @Req() req: AuthRequest) {
    return this.commission.recordPayout(dto, viewerOf(req));
  }

  @Get('summary/:userId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({ summary: 'Commission summary for a user' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  summary(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: AuthRequest,
  ) {
    return this.commission.summary(userId, viewerOf(req));
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update a commission record (admin)',
    description:
      'Status transitions are validated. A paid record cannot be re-priced — post an offsetting adjustment instead.',
  })
  @ApiParam({ name: 'id', description: 'Commission event UUID' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommissionEventDto,
    @Req() req: AuthRequest,
  ) {
    return this.commission.update(id, dto, viewerOf(req));
  }
}
