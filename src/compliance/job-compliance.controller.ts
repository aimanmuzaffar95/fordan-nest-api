import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { ComplianceService } from './compliance.service';
import { SubmitJobComplianceDto } from './dto/submit-job-compliance.dto';
import { SetChecklistTickDto } from './dto/set-checklist-tick.dto';

@ApiTags('Job compliance')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('jobs/:jobId/compliance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class JobComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('submissions')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'List compliance submissions for a job',
    description:
      'Scoped like other job resources: managers and installers only see jobs in their scope.',
  })
  listSubmissions(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.compliance.listSubmissionsForJob(jobId, { userId, role });
  }

  @Get('checklist-ticks')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Manual CEC checklist tick state for a job',
    description:
      'Items are defined centrally in admin settings (complianceChecklistConfig); ticks reference their string ids.',
  })
  listChecklistTicks(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.compliance.listChecklistTicks(jobId, { userId, role });
  }

  @Put('checklist-ticks/:itemId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Set a manual CEC checklist tick (idempotent upsert)',
  })
  setChecklistTick(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Param('itemId') itemId: string,
    @Body() dto: SetChecklistTickDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.compliance.setChecklistTick(jobId, itemId, dto.done, {
      userId,
      role,
    });
  }

  @Post('submissions')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Submit a completed compliance form',
    description:
      'One submission per template per job. Signature required when **complianceRequireSignature** is enabled in admin settings.',
  })
  @ApiCreatedResponse({ description: 'Submission id returned.' })
  submit(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: SubmitJobComplianceDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.compliance.submitForJob(jobId, dto, { userId, role });
  }
}
