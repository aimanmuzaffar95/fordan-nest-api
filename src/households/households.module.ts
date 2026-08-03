import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { SystemAuditModule } from '../system-audit/system-audit.module';
import { CustomerMergeLog } from './entities/customer-merge-log.entity';
import { HouseholdsController } from './households.controller';
import { HouseholdsService } from './households.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, CustomerMergeLog]),
    RuntimeSettingsModule,
    SystemAuditModule,
  ],
  controllers: [HouseholdsController],
  providers: [HouseholdsService],
  exports: [HouseholdsService],
})
export class HouseholdsModule {}
