import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
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
