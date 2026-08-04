import {
  Controller,
  Get,
  Header,
  Param,
  ParseEnumPipe,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { CrmBrandingUploadSlot } from '../files/crm-branding.constants';
import { FilesService } from '../files/files.service';

@ApiTags('Public')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: 60_000, limit: 60 } })
@Controller('public/crm-branding')
export class PublicCrmBrandingController {
  constructor(private readonly files: FilesService) {}

  @Get(':slot')
  @Header('Cache-Control', 'public, max-age=3600')
  // helmet defaults every response to `same-origin`, which makes the browser
  // refuse this image whenever the web app is on a different origin to the API
  // — true in staging (:8081 vs :3001) and in production (app domain vs
  // api.*). These assets are public and unauthenticated by design, so opting
  // this route out is safe; relaxing helmet globally would not be.
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
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
