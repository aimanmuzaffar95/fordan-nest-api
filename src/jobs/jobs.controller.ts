import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
  Query,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPreconditionFailedResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FilesService } from '../files/files.service';
import { uploadFileFilter } from '../files/upload-file-filter';
import { UploadJobFileDto } from './dto/upload-job-file.dto';
import { UploadedBinaryFile } from '../files/uploaded-binary-file.type';
import { DEFAULT_MAX_UPLOAD_SIZE_BYTES } from '../files/upload.constants';
import { UserRole } from '../users/entities/user-role.enum';
import { FindJobsQueryDto } from './dto/find-jobs-query.dto';
import { CreateJobTextEntryDto } from './dto/create-job-text-entry.dto';
import { TransitionJobStageDto } from './dto/transition-job-stage.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { UpdateJobPipelineDto } from './dto/update-job-pipeline.dto';
import { UpdateJobProposalConfigDto } from './dto/update-job-proposal-config.dto';
import { LeadCaptureInsightsService } from '../reports/lead-capture-insights.service';
import { JobsService } from './jobs.service';
import { JobQuotationService } from './job-quotation.service';
import { SendJobQuotationResponseDto } from './dto/send-job-quotation-response.dto';
import { CreateJobSignatureRequestDto } from './dto/create-job-signature-request.dto';
import { JobSignatureService } from './job-signature.service';

@ApiTags('Jobs')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly jobQuotation: JobQuotationService,
    private readonly filesService: FilesService,
    private readonly leadCaptureInsightsService: LeadCaptureInsightsService,
    private readonly jobSignatures: JobSignatureService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'List jobs',
    description:
      '**Manager:** only jobs where `managerId` matches the authenticated user. **Installer:** only jobs where you are `assignedStaffUserId` or have a direct assignment row. **Admin:** all jobs (subject to filters).',
  })
  list(
    @Query() query: FindJobsQueryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.jobs.list(query, { userId, role });
  }

  /** Static path must stay above `@Get(':id')` so it is not swallowed as a UUID. */
  @Get('lead-capture-insights')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Lead capture analytics (public form submissions)',
    description:
      'Aggregates job notes from public lead submissions (`__FORDAN_LEAD_META__` line or legacy “Lead source: public web form” text). **Manager:** only jobs assigned to you.',
  })
  leadCaptureInsights(
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.leadCaptureInsightsService.getInsights({ userId, role });
  }

  @Post(':id/stage')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  transitionStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionJobStageDto,
    @Req() req: Request & { user?: { sub: string; role: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    return this.jobs.transitionStage(
      userId,
      role,
      id,
      dto.toStage,
      dto.overridePreMeterLock ?? false,
    );
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Get job by id',
    description:
      '**Manager:** **404** if the job is not assigned to you via `managerId`. **Installer:** **404** if the job is not assigned to you (directly or via team). Same response as unknown id (no leak).',
  })
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.jobs.getOne(id, { userId, role });
  }

  @Get(':id/files')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'List files for a job',
    description:
      'Returns file metadata linked to the job detail page. **Manager/Installer:** **404** if the job is outside your scope.',
  })
  @ApiOkResponse({ description: 'Job file metadata.' })
  @ApiNotFoundResponse({
    description:
      'Unknown job id, or the authenticated manager/installer attempted to access a job outside their scope.',
  })
  listFiles(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    return this.filesService.listJobFiles(id, { userId, role });
  }

  @Post(':id/files')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: DEFAULT_MAX_UPLOAD_SIZE_BYTES,
      },
      fileFilter: uploadFileFilter(),
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a file for a job',
    description:
      'Multipart upload for job images or PDFs. Persists a user-facing display name for the job detail page and writes **`job_file_uploaded`** on the job timeline. **Manager/Installer:** **404** if the job is outside your scope.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['displayName', 'file'],
      properties: {
        displayName: {
          type: 'string',
          example: 'Roof photos - north side',
        },
        kind: {
          type: 'string',
          enum: [
            'photos',
            'signed_paperwork',
            'meter_docs',
            'compliance',
            'other',
          ],
          default: 'other',
        },
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'File stored and metadata recorded.' })
  @ApiNotFoundResponse({
    description:
      'Unknown job id, or the authenticated manager/installer attempted to access a job outside their scope.',
  })
  uploadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadJobFileDto,
    @UploadedFile() file: UploadedBinaryFile | undefined,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    return this.filesService.uploadJobFile(id, dto, file, { userId, role });
  }

  @Get(':id/files/:fileId/download')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Download a job file',
    description:
      'Streams a stored file through the API so access remains protected by JWT + RBAC. **Manager/Installer:** **404** if the job or file is outside your scope.',
  })
  @ApiOkResponse({ description: 'Binary file stream.' })
  @ApiNotFoundResponse({
    description:
      'Unknown job id, unknown file id, or the authenticated manager/installer attempted to access a file outside their scope.',
  })
  @Header('Cache-Control', 'private, no-store')
  async downloadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    const download = await this.filesService.getJobFileDownload(id, fileId, {
      userId,
      role,
    });

    const safeFileName = (
      download.file.displayName ??
      download.file.originalName ??
      'download'
    )
      .replace(/[\r\n"]/g, '_')
      .trim();

    if (download.file.contentType) {
      res.setHeader('Content-Type', download.file.contentType);
    }
    if (download.contentLength !== undefined) {
      res.setHeader('Content-Length', String(download.contentLength));
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFileName || 'download'}"`,
    );

    return new StreamableFile(download.stream);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Update non-pipeline job fields',
    description:
      'Updates live job detail summary fields such as system details, pricing, deposit/contract state, scheduling dates, and manager assignment. Returns the refreshed job detail payload.',
  })
  updateJob(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.jobs.updateJob(id, dto, { userId, role });
  }

  @Post(':id/notes')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Add job note',
    description:
      'Creates a persisted job note. Response includes the stored author and timestamps for immediate job-detail rendering.',
  })
  createNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateJobTextEntryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.jobs.createNote(id, dto, { userId, role });
  }

  @Post(':id/internal-comments')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Add job internal comment',
    description:
      'Creates a persisted internal comment for the job. Response includes the stored author and timestamps for immediate job-detail rendering.',
  })
  createInternalComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateJobTextEntryDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.jobs.createInternalComment(id, dto, { userId, role });
  }

  @Get(':id/proposal-config')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Get job proposal configuration',
    description:
      'Returns the persisted proposal-only equipment selections for a job. **Installer:** **404** if the job is not assigned to you.',
  })
  getProposalConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.jobs.getProposalConfig(id, { userId, role });
  }

  @Put(':id/proposal-config')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Replace job proposal configuration',
    description:
      'Persists the proposal-only equipment selection set for the job. Existing proposal selections are replaced atomically, and the live job summary fields are re-derived from the saved proposal equipment and pricing.',
  })
  updateProposalConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobProposalConfigDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.jobs.updateProposalConfig(id, dto, { userId, role });
  }

  @Get(':id/signature-requests')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'List e-signature requests for a job',
    description:
      'Returns recent signature requests (pending, viewed, signed, etc.). **Manager:** only within your job scope.',
  })
  listSignatureRequests(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.jobSignatures.listForJob(id, { userId, role });
  }

  @Post(':id/signature-requests')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Create e-signature request (quotation)',
    description:
      'Creates a signing link for the current saved proposal quotation. Cancels other open requests for the job. Public signing URL: admin Settings, `ESIGN_PUBLIC_BASE_URL`, `ESIGN_ALLOWED_PUBLIC_ORIGINS`, or (localhost only) `Origin` / `X-Public-Web-Base-Url` from the browser. **503** when `sendEmail` is true and SMTP fails.',
  })
  createSignatureRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateJobSignatureRequestDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    const sendEmail = dto.sendEmail !== false;
    return this.jobSignatures.createRequest(
      id,
      { userId, role },
      sendEmail,
      req,
    );
  }

  @Post(':id/send-quotation')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Send quotation email to the job customer',
    description:
      'Builds the quotation email and PDF attachment from the persisted proposal configuration, sends it to the customer email on file, and records a `quotation_sent` timeline event. **Manager:** only within your job scope.',
  })
  @ApiOkResponse({
    description: 'Quotation sent successfully',
    type: SendJobQuotationResponseDto,
  })
  sendQuotation(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    return this.jobQuotation.sendQuotation(id, { userId, role });
  }

  @Patch(':id/pipeline')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Update job pipeline stage / ordering',
    description:
      '**412 Precondition Failed** (`code: PRECONDITION_FAILED`) when a **non-admin** moves to `installed` without an approved **pre_meter** application. **Admin** may override.',
  })
  @ApiPreconditionFailedResponse({
    description:
      'Stage gating failed — body includes `code: "PRECONDITION_FAILED"` (e.g. pre-meter not approved for `installed`).',
  })
  updatePipeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobPipelineDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    // JwtAuthGuard + RolesGuard should make this safe; still guard for runtime safety.
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.jobs.updateJobPipeline(id, dto, role, userId);
  }
}
