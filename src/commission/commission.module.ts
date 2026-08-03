import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { SystemAuditModule } from '../system-audit/system-audit.module';
import { CommissionEvent } from './entities/commission-event.entity';
import { CommissionController } from './commission.controller';
import { CommissionService } from './commission.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CommissionEvent]),
    RuntimeSettingsModule,
    SystemAuditModule,
  ],
  controllers: [CommissionController],
  providers: [CommissionService],
  exports: [CommissionService],
})
export class CommissionModule {}
