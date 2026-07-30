import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MailService } from './mail.service';
import { SendMailDto, UpdateSignatureDto } from './dto/mail.dto';

type AuthedRequest = Request & { user?: { sub?: string } };

/** Self-serve webmail for the signed-in user's linked mailbox. */
@ApiTags('Mail')
@ApiBearerAuth('JWT')
@Controller('mail')
@UseGuards(JwtAuthGuard)
export class MailController {
  constructor(private readonly mail: MailService) {}

  private userId(req: AuthedRequest): string {
    const id = req.user?.sub;
    if (!id) {
      throw new Error('Missing authenticated user context');
    }
    return id;
  }

  @Get('mailbox')
  getMailbox(@Req() req: AuthedRequest) {
    return this.mail.getMyMailbox(this.userId(req));
  }

  @Get('folders')
  listFolders(@Req() req: AuthedRequest) {
    return this.mail.listFolders(this.userId(req));
  }

  @Get('messages')
  listMessages(
    @Req() req: AuthedRequest,
    @Query('folder', new DefaultValuePipe('INBOX')) folder: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
  ) {
    return this.mail.listMessages(this.userId(req), folder, page, limit);
  }

  @Get('messages/:uid')
  getMessage(
    @Req() req: AuthedRequest,
    @Param('uid', ParseIntPipe) uid: number,
    @Query('folder', new DefaultValuePipe('INBOX')) folder: string,
  ) {
    return this.mail.getMessage(this.userId(req), uid, folder);
  }

  @Post('send')
  @HttpCode(HttpStatus.OK)
  send(@Req() req: AuthedRequest, @Body() dto: SendMailDto) {
    return this.mail.send(this.userId(req), dto);
  }

  @Patch('signature')
  updateSignature(@Req() req: AuthedRequest, @Body() dto: UpdateSignatureDto) {
    return this.mail.updateSignature(this.userId(req), dto.signatureHtml);
  }
}
