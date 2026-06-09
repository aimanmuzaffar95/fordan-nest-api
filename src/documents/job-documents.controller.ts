import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import type { PermissionKey } from '../permissions/permission-catalog';
import { PermissionsService } from '../permissions/permissions.service';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateDocumentSignRequestDto } from './dto/create-document-sign-request.dto';
import { GenerateJobDocumentDto } from './dto/generate-job-document.dto';
import { JobDocumentsService } from './job-documents.service';

@ApiTags('Job documents')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('jobs/:jobId/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class JobDocumentsController {
  constructor(
    private readonly documents: JobDocumentsService,
    private readonly permissions: PermissionsService,
  ) {}

  private async authorize(
    req: Request & { user?: { sub?: string; role?: UserRole } },
    permission: PermissionKey,
  ): Promise<{ userId: string; role: UserRole }> {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    const effective = await this.permissions.getEffectiveForUser(userId);
    this.permissions.assertPermission(effective, permission);
    return { userId, role };
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'List generated documents for a job',
    description:
      'Returns stub-generated compliance PDFs and sign-request metadata. Scoped like other job resources.',
  })
  async list(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorize(req, 'compliance:submission:view');
    return this.documents.listForJob(jobId, viewer);
  }

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Generate a compliance document PDF (stub)',
    description:
      'Builds a stub PDF from `templateId` and optional merge `fields`, stores it as a job file, and records `document_generated` on the timeline. **TODO:** external document provider.',
  })
  @ApiCreatedResponse({ description: 'Document id and optional download URL.' })
  async generate(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: GenerateJobDocumentDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorize(req, 'compliance:submission:create');
    return this.documents.generateForJob(jobId, dto, viewer);
  }

  @Post(':documentId/sign-request')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Request e-sign for a generated document (stub)',
    description:
      'Creates a sign-request row and records `document_sign_requested` on the timeline. Email / on-device delivery is stubbed until provider integration.',
  })
  @ApiCreatedResponse({ description: 'Sign request id and status.' })
  async createSignRequest(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: CreateDocumentSignRequestDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const viewer = await this.authorize(req, 'compliance:submission:create');
    return this.documents.createSignRequest(jobId, documentId, dto, viewer);
  }
}
