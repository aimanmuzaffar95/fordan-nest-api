import {
  Body,
  Controller,
  Delete,
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
  CreateTerritoryDto,
  PreviewRoutingDto,
  UpdateTerritoryDto,
} from './dto/territory.dto';
import { LeadRoutingService } from './lead-routing.service';
import { TerritoriesService } from './territories.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

function roleOf(req: AuthRequest): UserRole {
  const role = req.user?.role;
  if (!role) throw new Error('Missing authenticated user context');
  return role;
}

@ApiTags('Territories')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('territories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TerritoriesController {
  constructor(
    private readonly territories: TerritoriesService,
    private readonly routing: LeadRoutingService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'List territories with their members' })
  list(@Req() req: AuthRequest) {
    return this.territories.list(roleOf(req));
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a territory (admin)' })
  create(@Body() dto: CreateTerritoryDto, @Req() req: AuthRequest) {
    return this.territories.create(dto, roleOf(req));
  }

  @Post('preview')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Preview which territory an address would match',
    description:
      'Read-only — resolves the matching territory and the reason, without assigning anything.',
  })
  async preview(@Body() dto: PreviewRoutingDto, @Req() req: AuthRequest) {
    await this.territories.list(roleOf(req)); // enforces the feature flag
    const match = await this.routing.matchTerritory(dto.address, dto.postcode);
    return match
      ? {
          matched: true,
          territoryId: match.territory.id,
          territoryName: match.territory.name,
          reason: match.reason,
        }
      : {
          matched: false,
          territoryId: null,
          territoryName: null,
          reason: null,
        };
  }

  @Post('reassign-stale')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Reassign leads past their territory SLA (admin)',
    description:
      'Runs automatically every 10 minutes alongside the task SLA sweep.',
  })
  reassignStale() {
    return this.routing.reassignStaleLeads();
  }

  @Get('routing-history/:customerId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Routing audit trail for a customer' })
  @ApiParam({ name: 'customerId', description: 'Customer UUID' })
  history(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.routing.historyForCustomer(customerId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get a territory' })
  @ApiParam({ name: 'id', description: 'Territory UUID' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.territories.findOne(id, roleOf(req));
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update a territory (admin)',
    description:
      'Supplying `members` replaces the member list; unchanged members keep their rotation counters.',
  })
  @ApiParam({ name: 'id', description: 'Territory UUID' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTerritoryDto,
    @Req() req: AuthRequest,
  ) {
    return this.territories.update(id, dto, roleOf(req));
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Retire a territory (admin)',
    description: 'Soft delete — routing history stays readable.',
  })
  @ApiParam({ name: 'id', description: 'Territory UUID' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.territories.remove(id, roleOf(req));
  }
}
