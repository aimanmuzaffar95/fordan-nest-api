import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { UpdateMeterApplicationDto } from './dto/update-meter-application.dto';
import { MeterApplicationsService } from './meter-applications.service';
import { UploadOwnedFileDto } from '../files/dto/upload-owned-file.dto';
import { FilesService } from '../files/files.service';
import { uploadFileFilter } from '../files/upload-file-filter';
import { UploadedBinaryFile } from '../files/uploaded-binary-file.type';
import { DEFAULT_MAX_UPLOAD_SIZE_BYTES } from '../files/upload.constants';

@ApiTags('Metering')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('meter-applications')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class MeterApplicationsController {
  constructor(
    private readonly meters: MeterApplicationsService,
    private readonly filesService: FilesService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('meter:view')
  @ApiOperation({
    summary: 'List meter applications',
    description:
      'Returns live meter application rows for dashboard and operational workflows. Optional `jobId` (UUID) narrows to a single job. **Manager:** only meter applications whose parent job has `managerId = auth.user.id`.',
  })
  list(
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
    @Query('jobId', new ParseUUIDPipe({ optional: true }))
    jobId?: string,
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.meters.list({ userId, role }, { jobId });
  }

  @Get(':id/files')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('meter:file:view')
  @ApiOperation({
    summary: 'List files for a meter application',
    description:
      'Returns file metadata linked to the meter application. **Manager:** only meter applications whose parent job has `managerId = auth.user.id`.',
  })
  @ApiOkResponse({ description: 'Meter application file metadata.' })
  @ApiNotFoundResponse({
    description:
      'Unknown meter application id, or manager attempted to access a meter application outside their job scope.',
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

    return this.filesService.listMeterApplicationFiles(id, { userId, role });
  }

  @Post(':id/files')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('meter:file:upload')
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
    summary: 'Upload a file for a meter application',
    description:
      'Multipart upload for meter application documents or images. **Manager:** only meter applications whose parent job has `managerId = auth.user.id`. Writes **`meter_file_uploaded`** on the job timeline.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        kind: {
          type: 'string',
          enum: [
            'photos',
            'signed_paperwork',
            'meter_docs',
            'compliance',
            'other',
          ],
          default: 'meter_docs',
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
      'Unknown meter application id, or manager attempted to access a meter application outside their job scope.',
  })
  uploadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadOwnedFileDto,
    @UploadedFile() file: UploadedBinaryFile | undefined,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    return this.filesService.uploadMeterApplicationFile(id, dto, file, {
      userId,
      role,
    });
  }

  @Get(':id/files/:fileId/download')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequirePermission('meter:file:view')
  @ApiOperation({
    summary: 'Download a meter application file',
    description:
      'Streams a stored file through the API so access remains protected by JWT + RBAC. **Manager:** only meter applications whose parent job has `managerId = auth.user.id`.',
  })
  @ApiOkResponse({ description: 'Binary file stream.' })
  @ApiNotFoundResponse({
    description:
      'Unknown meter application id, unknown file id, or manager attempted to access a file outside their job scope.',
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

    const download = await this.filesService.getMeterApplicationFileDownload(
      id,
      fileId,
      { userId, role },
    );

    const safeFileName = (download.file.originalName ?? 'download')
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
  @RequirePermission('meter:update')
  @ApiOperation({
    summary: 'Update meter application status',
    description:
      '**Admin/manager only.** Sets **`pending`**, **`approved`**, or **`rejected`**. When **`rejected`**, **`rejectionReason`** must be a non-empty string. **Manager:** only meter applications whose parent job has `managerId = auth.user.id`. Writes **`meter_status_change`** on the job timeline.',
  })
  @ApiNotFoundResponse({
    description:
      'Unknown meter application id, or manager attempted to access a meter application outside their job scope.',
  })
  @ApiForbiddenResponse({ description: 'Installer or other disallowed role.' })
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMeterApplicationDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    if (!req.user?.role || !userId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    return this.meters.updateStatus(id, dto, {
      userId,
      role: req.user.role,
    });
  }
}
