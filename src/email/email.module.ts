import { Global, Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { AdminSettings } from '../runtime-settings/admin-settings.entity';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { CustomerMessagingRendererService } from './customer-messaging-renderer.service';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';
import { createEmailProvider } from './email-provider.factory';
import { EmailTracking } from './email-tracking.entity';
import { PublicEmailTrackingController } from './public-email-tracking.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AdminSettings, EmailTracking]),
    RuntimeSettingsModule,
  ],
  controllers: [EmailController, PublicEmailTrackingController],
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
