import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { Project } from '../projects/entities/project.entity';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { PortalAccessToken } from './entities/portal-access-token.entity';
import {
  CustomerPortalAdminController,
  CustomerPortalPublicController,
} from './customer-portal.controller';
import { CustomerPortalService } from './customer-portal.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PortalAccessToken, Job, Customer, Project]),
    RuntimeSettingsModule,
  ],
  controllers: [CustomerPortalAdminController, CustomerPortalPublicController],
  providers: [CustomerPortalService],
  exports: [CustomerPortalService],
})
export class CustomerPortalModule {}
