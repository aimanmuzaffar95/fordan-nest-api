import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { MailService } from './mail.service';
import { CreateMailboxDto, UpdateMailboxDto } from './dto/mailbox.dto';

/** Admin-only management of per-user linked mailboxes (Settings → Mailboxes). */
@ApiTags('Settings')
@ApiBearerAuth('JWT')
@Controller('settings/mailboxes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class MailboxesController {
  constructor(private readonly mail: MailService) {}

  @Get()
  list() {
    return this.mail.listMailboxes();
  }

  @Post()
  create(@Body() dto: CreateMailboxDto) {
    return this.mail.createMailbox(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMailboxDto,
  ) {
    return this.mail.updateMailbox(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.mail.deleteMailbox(id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(@Param('id', ParseUUIDPipe) id: string) {
    return this.mail.testMailbox(id);
  }
}
