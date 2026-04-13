import {
  Controller,
  Get,
  Header,
  Param,
  ParseEnumPipe,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CrmBrandingUploadSlot } from '../files/crm-branding.constants';
import { FilesService } from '../files/files.service';

@ApiTags('Public')
@Controller('public/crm-branding')
export class PublicCrmBrandingController {
  constructor(private readonly files: FilesService) {}

  @Get(':slot')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({
    summary: 'Public CRM logo or favicon binary',
    description:
      'No authentication. Serves the latest admin-uploaded branding file for use in `<img>` and favicon tags.',
  })
  async getBranding(
    @Param('slot', new ParseEnumPipe(CrmBrandingUploadSlot))
    slot: CrmBrandingUploadSlot,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const download = await this.files.getPublicCrmBrandingDownload(slot);
    const ct = download.file.contentType?.trim() || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    if (download.contentLength !== undefined) {
      res.setHeader('Content-Length', String(download.contentLength));
    }
    res.setHeader('Content-Disposition', 'inline');
    return new StreamableFile(download.stream);
  }
}
