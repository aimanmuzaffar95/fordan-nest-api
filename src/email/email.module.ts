import { Global, Module } from '@nestjs/common';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';
import { SmtpProvider } from './providers/smtp.provider';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';

@Global()
@Module({
  imports: [RuntimeSettingsModule],
  controllers: [EmailController],
  providers: [
    SmtpProvider,
    {
      provide: EMAIL_PROVIDER,
      useExisting: SmtpProvider,
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
