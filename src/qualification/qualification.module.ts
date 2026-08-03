import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { TasksModule } from '../tasks/tasks.module';
import { QualificationController } from './qualification.controller';
import { QualificationService } from './qualification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer]),
    RuntimeSettingsModule,
    TasksModule,
  ],
  controllers: [QualificationController],
  providers: [QualificationService],
  exports: [QualificationService],
})
export class QualificationModule {}
