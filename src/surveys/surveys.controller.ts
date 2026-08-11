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
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { UpsertSurveyDto } from './dto/upsert-survey.dto';
import { SurveysService } from './surveys.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

function viewerOf(req: AuthRequest): { userId: string; role: UserRole } {
  const userId = req.user?.sub;
  const role = req.user?.role;
  if (!userId || !role) throw new Error('Missing authenticated user context');
  return { userId, role };
}

@ApiTags('Surveys')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class SurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get('jobs/:jobId/surveys')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @RequirePermission('survey:view')
  @ApiOperation({ summary: 'List site surveys for a job' })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  list(@Param('jobId', ParseUUIDPipe) jobId: string, @Req() req: AuthRequest) {
    return this.surveys.listForJob(jobId, viewerOf(req));
  }

  @Post('jobs/:jobId/surveys')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @RequirePermission('survey:manage')
  @ApiOperation({
    summary: 'Create or update a site survey',
    description:
      'Idempotent on `clientRequestId` so the mobile offline queue can replay safely. Only fields present in the body are written, so a partial sync never blanks earlier findings.',
  })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  upsert(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: UpsertSurveyDto,
    @Req() req: AuthRequest,
  ) {
    return this.surveys.upsert(jobId, dto, viewerOf(req));
  }

  @Get('surveys/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @RequirePermission('survey:view')
  @ApiOperation({ summary: 'Get a site survey' })
  @ApiParam({ name: 'id', description: 'Survey UUID' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.surveys.findOne(id, viewerOf(req));
  }
}
