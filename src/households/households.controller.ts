import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { PermissionsService } from '../permissions/permissions.service';
import { UserRole } from '../users/entities/user-role.enum';
import { HouseholdsService } from './households.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

function viewerOf(req: AuthRequest): { userId: string; role: UserRole } {
  const userId = req.user?.sub;
  const role = req.user?.role;
  if (!userId || !role) throw new Error('Missing authenticated user context');
  return { userId, role };
}

export class MergeCustomersDto {
  /** The record that is folded in and retired. */
  @IsUUID()
  mergedCustomerId: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  reason?: string;
}

@ApiTags('Households')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class HouseholdsController {
  constructor(
    private readonly households: HouseholdsService,
    private readonly permissions: PermissionsService,
  ) {}

  private async canViewCustomerPii(req: AuthRequest): Promise<boolean> {
    const userId = req.user?.sub;
    if (!userId) return false;
    const effective = await this.permissions.getEffectiveForUser(userId);
    return this.permissions.hasPermission(effective, 'customer:pii:view');
  }

  @Post('household-keys/backfill')
  @Roles(UserRole.ADMIN)
  @RequirePermission('household:manage')
  @ApiOperation({
    summary: 'Backfill household keys (admin)',
    description:
      'Computes the normalised address key for customers that do not have one. Idempotent.',
  })
  backfill() {
    return this.households.backfillHouseholdKeys();
  }

  @Get(':id/duplicates')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('household:view')
  @ApiOperation({
    summary: 'Possible duplicates of a customer',
    description:
      'Matches on email, phone digits and a normalised household address key. Strongest signal first.',
  })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  async duplicates(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.households.findDuplicates(
      id,
      viewerOf(req).role,
      await this.canViewCustomerPii(req),
    );
  }

  @Get(':id/household')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('household:view')
  @ApiOperation({ summary: 'Other customers at the same property' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  async household(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.households.householdMembers(
      id,
      viewerOf(req).role,
      await this.canViewCustomerPii(req),
    );
  }

  @Get(':id/merge-history')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('household:view')
  @ApiOperation({ summary: 'Merges involving this customer' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  mergeHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.households.mergeHistory(id, viewerOf(req).role);
  }

  @Post(':id/merge')
  @Roles(UserRole.ADMIN)
  @RequirePermission('household:manage')
  @ApiOperation({
    summary: 'Merge another customer into this one (admin)',
    description:
      'The path customer survives. Jobs, invoices and audit rows are reparented; blank survivor fields are filled from the merged record; the merged record is retired, never deleted. Fully audited.',
  })
  @ApiParam({ name: 'id', description: 'Surviving customer UUID' })
  merge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MergeCustomersDto,
    @Req() req: AuthRequest,
  ) {
    const viewer = viewerOf(req);
    return this.households.merge({
      survivorCustomerId: id,
      mergedCustomerId: dto.mergedCustomerId,
      reason: dto.reason ?? null,
      actorUserId: viewer.userId,
      role: viewer.role,
    });
  }
}
