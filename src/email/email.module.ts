import { Global, Module } from '@nestjs/common';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';
import { createEmailProvider } from './email-provider.factory';

@Global()
@Module({
  controllers: [EmailController],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      useFactory: createEmailProvider,
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
