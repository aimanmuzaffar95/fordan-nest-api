import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerNotesService } from './customer-notes.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { Customer } from './entities/customer.entity';
import { CustomerAuditLog } from './entities/customer-audit-log.entity';
import { CustomerNote } from './entities/customer-note.entity';
import { JobsModule } from '../jobs/jobs.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { TerritoriesModule } from '../territories/territories.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, CustomerAuditLog, CustomerNote]),
    JobsModule,
    PermissionsModule,
    TerritoriesModule,
  ],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerNotesService],
  exports: [CustomersService],
})
export class CustomersModule {}
