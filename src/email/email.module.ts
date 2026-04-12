import { Global, Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { AdminSettings } from '../runtime-settings/admin-settings.entity';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { CustomerMessagingRendererService } from './customer-messaging-renderer.service';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';
import { createEmailProvider } from './email-provider.factory';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AdminSettings]),
    RuntimeSettingsModule,
  ],
  controllers: [EmailController],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      useFactory: createEmailProvider,
      inject: [getRepositoryToken(AdminSettings)],
    },
    EmailService,
    CustomerMessagingRendererService,
  ],
  exports: [EmailService, CustomerMessagingRendererService],
})
export class EmailModule {}
