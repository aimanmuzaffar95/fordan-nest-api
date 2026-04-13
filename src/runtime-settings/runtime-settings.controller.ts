import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import {
  CRM_BRANDING_FAVICON_MIME_TYPES,
  CRM_BRANDING_LOGO_MIME_TYPES,
  CRM_BRANDING_MAX_FILE_BYTES,
  CrmBrandingUploadSlot,
} from '../files/crm-branding.constants';
import { FilesService } from '../files/files.service';
import { uploadFileFilter } from '../files/upload-file-filter';
import { UploadedBinaryFile } from '../files/uploaded-binary-file.type';
import { RuntimeSettingsService } from './runtime-settings.service';
import { UpdateAdminSettingsDto } from './dto/update-admin-settings.dto';

const CRM_BRANDING_UPLOAD_MIME_TYPES = [
  ...new Set([
    ...CRM_BRANDING_LOGO_MIME_TYPES,
    ...CRM_BRANDING_FAVICON_MIME_TYPES,
  ]),
];

@ApiTags('Settings')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RuntimeSettingsController {
  constructor(
    private readonly settings: RuntimeSettingsService,
    private readonly files: FilesService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Get persisted admin settings',
    description:
      'Returns the global configuration used by the Settings screen and downstream alert/scheduling logic. Readable by any authenticated user.',
  })
  getSettings() {
    return this.settings.getSettings();
  }

  @Patch()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update persisted admin settings',
    description:
      'Admin-only. Persists the provided subset of settings and returns the full saved configuration.',
  })
  updateSettings(
    @Body() dto: UpdateAdminSettingsDto,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('Missing authenticated user context');
    }
    return this.settings.updateSettings(dto, userId);
  }

  @Post('branding/:slot')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: CRM_BRANDING_MAX_FILE_BYTES },
      fileFilter: uploadFileFilter(CRM_BRANDING_UPLOAD_MIME_TYPES),
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
  @ApiCreatedResponse({
    description:
      '`publicPath` is relative to the API root (prefix with the same base URL used for `/api`).',
  })
  @ApiOperation({
    summary: 'Upload CRM logo or favicon (admin)',
    description:
      'Stores the file and returns a path served without auth at `GET /api/public/crm-branding/:slot`. Set `crmAppearanceSettings.logoUrl` / `faviconUrl` to the full URL (web origin + `/api` + `publicPath`) or rely on the Settings UI to apply it.',
  })
  uploadBranding(
    @Param('slot', new ParseEnumPipe(CrmBrandingUploadSlot))
    slot: CrmBrandingUploadSlot,
    @UploadedFile() file: UploadedBinaryFile | undefined,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
  ) {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }
    return this.files.uploadCrmBrandingAsset(slot, file, {
      userId,
      role,
    });
  }
}
