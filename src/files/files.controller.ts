import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { FilesService } from './files.service';

@ApiTags('Files')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller('files')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Download file by id',
    description:
      'Streams the binary when the authenticated user can access the owning record (e.g. meter application on an in-scope job).',
  })
  @ApiProduces('application/octet-stream', 'application/pdf', 'image/jpeg')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { sub?: string; role?: UserRole } },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new Error('Missing authenticated user context');
    }

    const { stream, contentType, filename } =
      await this.files.openDownloadStream(id, { userId, role });

    const safeName = filename.replace(/[\r\n"]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );

    return new StreamableFile(stream, { type: contentType });
  }
}
