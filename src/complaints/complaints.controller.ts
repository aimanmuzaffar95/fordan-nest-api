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
  ApiResponse,
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
import { ComplaintsService } from './complaints.service';
import { CreateComplaintMessageDto } from './dto/create-complaint-message.dto';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import {
  ComplaintResponseDto,
  ComplaintsListResponseDto,
} from './dto/complaint-response.dto';
import { ComplaintsQueryDto } from './dto/complaints-query.dto';
import { UpdateComplaintDto } from './dto/update-complaint.dto';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

const VIEW_ROLES = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.INSTALLER,
] as const;
const MANAGE_ROLES = [UserRole.ADMIN, UserRole.MANAGER] as const;

function viewerOf(req: AuthRequest): { userId: string; role: UserRole } {
  const userId = req.user?.sub;
  const role = req.user?.role;
  if (!userId || !role) {
    throw new Error('Missing authenticated user context');
  }
  return { userId, role };
}

@ApiTags('Complaints')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('complaints')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  @Roles(...VIEW_ROLES)
  @RequirePermission('complaint:view')
  @ApiOperation({
    summary: 'List complaints',
    description:
      '**Admin/Manager:** everything (`scope=all` default). **Installer:** always their own assigned complaints (`scope` is ignored).',
  })
  @ApiResponse({ status: 200, type: ComplaintsListResponseDto })
  findAll(
    @Query() query: ComplaintsQueryDto,
    @Req() req: AuthRequest,
  ): Promise<ComplaintsListResponseDto> {
    return this.complaints.findAll(query, viewerOf(req));
  }

  @Post()
  @Roles(...MANAGE_ROLES)
  @RequirePermission('complaint:manage')
  @ApiOperation({
    summary: 'Create a complaint',
    description:
      'Creates the complaint with `status = new`, and records a `created` timeline event plus the initial complaint body as the first `reply`.',
  })
  @ApiResponse({ status: 201, type: ComplaintResponseDto })
  create(
    @Body() dto: CreateComplaintDto,
    @Req() req: AuthRequest,
  ): Promise<ComplaintResponseDto> {
    return this.complaints.create(dto, viewerOf(req));
  }

  @Get(':id')
  @Roles(...VIEW_ROLES)
  @RequirePermission('complaint:view')
  @ApiOperation({
    summary: 'Get a complaint with its full timeline (oldest first)',
  })
  @ApiParam({ name: 'id', description: 'Complaint UUID' })
  @ApiResponse({ status: 200, type: ComplaintResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ): Promise<ComplaintResponseDto> {
    return this.complaints.findOne(id, viewerOf(req));
  }

  @Patch(':id')
  @Roles(...MANAGE_ROLES)
  @RequirePermission('complaint:manage')
  @ApiOperation({
    summary: 'Update a complaint',
    description:
      'Update status, priority, assignee, or subject. A complaint can never move back to `new` once left, and cannot be updated at all once `closed`.',
  })
  @ApiParam({ name: 'id', description: 'Complaint UUID' })
  @ApiResponse({ status: 200, type: ComplaintResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateComplaintDto,
    @Req() req: AuthRequest,
  ): Promise<ComplaintResponseDto> {
    return this.complaints.update(id, dto, viewerOf(req));
  }

  @Post(':id/messages')
  @Roles(...MANAGE_ROLES)
  @RequirePermission('complaint:manage')
  @ApiOperation({
    summary: 'Add a reply or internal note',
    description:
      '`visibility: reply` is customer-facing; `visibility: note` is staff-only. Optionally pass `status` to move the complaint in the same request (HubSpot reply+status pattern). Blocked once the complaint is `closed`.',
  })
  @ApiParam({ name: 'id', description: 'Complaint UUID' })
  @ApiResponse({ status: 201, type: ComplaintResponseDto })
  addMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateComplaintMessageDto,
    @Req() req: AuthRequest,
  ): Promise<ComplaintResponseDto> {
    return this.complaints.addMessage(id, dto, viewerOf(req));
  }
}
