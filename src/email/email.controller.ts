import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../auth/decorators/role-access.decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SendTestEmailDto } from './dto/send-test-email.dto';
import { EmailService } from './email.service';

@ApiTags('Email')
@ApiBearerAuth('JWT')
@Controller('email')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Get('tracking')
  @AdminOnly()
  async listTracking(@Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 50;
    const rows = await this.email.listTracking(n);
    return rows.map((r) => ({
      messageId: r.messageId,
      to: r.to,
      subject: r.subject,
      sentAt: r.sentAt,
      opened: Boolean(r.firstOpenedAt),
      firstOpenedAt: r.firstOpenedAt,
      lastOpenedAt: r.lastOpenedAt,
      openCount: r.openCount,
      createdAt: r.createdAt,
    }));
  }

  @Get('tracking/:messageId')
  @AdminOnly()
  async getTracking(@Param('messageId') messageId: string) {
    const r = await this.email.getTracking(messageId);
    if (!r) return { found: false };
    return {
      found: true,
      messageId: r.messageId,
      to: r.to,
      subject: r.subject,
      sentAt: r.sentAt,
      opened: Boolean(r.firstOpenedAt),
      firstOpenedAt: r.firstOpenedAt,
      lastOpenedAt: r.lastOpenedAt,
      openCount: r.openCount,
      createdAt: r.createdAt,
    };
  }

  @Post('test')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Email sent successfully' })
  async sendEmail(@Body() dto: SendTestEmailDto): Promise<{ message: string }> {
    await this.email.send({
      to: dto.to,
      subject: dto.subject,
      html: dto.html,
      text: dto.text,
    });

    return { message: `Email sent to ${dto.to}` };
  }
}
