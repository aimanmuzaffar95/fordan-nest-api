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
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import {
  QUALIFICATION_STATUSES,
  QualificationService,
  type QualificationStatus,
} from './qualification.service';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

function viewerOf(req: AuthRequest): { userId: string; role: UserRole } {
  const userId = req.user?.sub;
  const role = req.user?.role;
  if (!userId || !role) throw new Error('Missing authenticated user context');
  return { userId, role };
}

export class AssessQualificationDto {
  @IsObject()
  answers: Record<string, unknown>;

  @IsOptional()
  @IsIn(QUALIFICATION_STATUSES as unknown as string[])
  status?: QualificationStatus;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  disqualificationReason?: string;
}

@ApiTags('Qualification')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class QualificationController {
  constructor(private readonly qualification: QualificationService) {}

  @Get('qualification/config')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Get the qualification criteria and scoring rules',
    description:
      'Edit them in Settings → System → Qualification (`PATCH /settings` with `qualificationConfig`).',
  })
  config(@Req() req: AuthRequest) {
    return this.qualification.getConfig(viewerOf(req).role);
  }

  @Get('qualification/nurture-due')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Nurture leads whose follow-up date has arrived' })
  nurtureDue(@Req() req: AuthRequest) {
    return this.qualification.listDueNurture(viewerOf(req).role);
  }

  @Get('customers/:id/qualification')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get a customer’s qualification state' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.qualification.getForCustomer(id, viewerOf(req).role);
  }

  @Post('customers/:id/qualification')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Record a qualification assessment',
    description:
      'Answers are merged with any already recorded, then re-scored against the current config. Omit `status` to derive it from the score; `disqualified` requires a configured reason.',
  })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  assess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssessQualificationDto,
    @Req() req: AuthRequest,
  ) {
    const viewer = viewerOf(req);
    return this.qualification.assess({
      customerId: id,
      answers: dto.answers,
      status: dto.status,
      disqualificationReason: dto.disqualificationReason ?? null,
      actorUserId: viewer.userId,
      role: viewer.role,
    });
  }
}
