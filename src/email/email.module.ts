import { Global, Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { AdminSettings } from '../runtime-settings/admin-settings.entity';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';
import { createEmailProvider } from './email-provider.factory';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AdminSettings])],
  controllers: [EmailController],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      useFactory: createEmailProvider,
      inject: [getRepositoryToken(AdminSettings)],
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
