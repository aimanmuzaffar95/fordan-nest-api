import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { EmailService } from './email.service';

const ONE_BY_ONE_GIF_BASE64 =
  'R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
const ONE_BY_ONE_GIF_BYTES = Buffer.from(ONE_BY_ONE_GIF_BASE64, 'base64');

@ApiExcludeController()
@Controller('public/email-open')
export class PublicEmailTrackingController {
  constructor(private readonly email: EmailService) {}

  @Get(':messageId.gif')
  @Header(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate',
  )
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  @Header('Content-Type', 'image/gif')
  async openPixel(@Param('messageId') messageId: string, @Res() res: Response) {
    // Never throw — pixels must always resolve.
    await this.email.recordOpen(messageId).catch(() => undefined);
    return res.status(200).send(ONE_BY_ONE_GIF_BYTES);
  }
}
