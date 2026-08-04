import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { Customer } from './entities/customer.entity';
import { CustomerAuditLog } from './entities/customer-audit-log.entity';
import { JobsModule } from '../jobs/jobs.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { TerritoriesModule } from '../territories/territories.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, CustomerAuditLog]),
    JobsModule,
    PermissionsModule,
    TerritoriesModule,
  ],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
