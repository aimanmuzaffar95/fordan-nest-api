import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { UpdateMeterApplicationDto } from './dto/update-meter-application.dto';
import { MeterApplicationsService } from './meter-applications.service';
import { maxUploadBytes } from '../files/upload-mime';
import type { MulterMemoryFile } from '../files/multer-memory-file.type';

@ApiTags('Metering')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('meter-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeterApplicationsController {
  constructor(private readonly meters: MeterApplicationsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'List meter applications',
    description:
      'Returns live meter application rows for dashboard and operational workflows. **Manager:** only meter applications whose parent job has `managerId = auth.user.id`.',
  })
  list(@Req() req: Request & { user?: { sub?: string; role?: UserRole } }) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.meters.list({ userId, role });
  }

  @Get(':id/files')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'List files attached to a meter application',
    description:
      '**Admin/manager/installer** when the parent job is in scope (same visibility as **`GET /jobs/:jobId`** for installers).',
  })
  listFiles(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.meters.listFiles(id, { userId, role });
  }

  @Post(':id/files')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: maxUploadBytes() },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a file for a meter application',
    description:
      'Multipart **`file`** field. Allowed types: **PDF**, **JPEG**, **PNG**, **WebP**. Max size from **`MAX_UPLOAD_BYTES`** (default 15 MiB). Stored under **`LOCAL_UPLOAD_DIR`** when **`STORAGE_DRIVER=local`**.',
  })
  uploadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: MulterMemoryFile | undefined,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    if (file === undefined) {
      throw new BadRequestException('Multipart field "file" is required');
    }
    return this.meters.uploadFile(id, file, { userId, role });
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
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
      throw new Error('Missing authenticated user context');
    }
    return this.meters.updateStatus(id, dto, {
      userId,
      role: req.user.role,
    });
  }
}
