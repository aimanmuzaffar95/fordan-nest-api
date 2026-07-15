import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { JobsModule } from '../jobs/jobs.module';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { User } from '../users/entities/user.entity';
import { PublicLeadsController } from './public-leads.controller';
import { PublicLeadsService } from './public-leads.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    CustomersModule,
    JobsModule,
    RuntimeSettingsModule,
  ],
  controllers: [PublicLeadsController],
  providers: [PublicLeadsService],
})
export class PublicLeadsModule {}
