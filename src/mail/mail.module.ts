import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolveJwtSecret } from '../auth/jwt-secret.util';
import { User } from '../users/entities/user.entity';
import { LinkedMailbox } from './linked-mailbox.entity';
import { MailMessage } from './mail-message.entity';
import { MailSyncService } from './mail-sync.service';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { MailboxesController } from './mailboxes.controller';

@Module({
  imports: [
    JwtModule.register({
      secret: resolveJwtSecret(),
    }),
    TypeOrmModule.forFeature([LinkedMailbox, MailMessage, User]),
  ],
  controllers: [MailController, MailboxesController],
  providers: [MailService, MailSyncService],
})
export class MailModule {}
