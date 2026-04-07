import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { JobsModule } from '../jobs/jobs.module';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { PublicLeadsController } from './public-leads.controller';
import { PublicLeadsService } from './public-leads.service';

@Module({
  imports: [CustomersModule, JobsModule, RuntimeSettingsModule],
  controllers: [PublicLeadsController],
  providers: [PublicLeadsService],
})
export class PublicLeadsModule {}
