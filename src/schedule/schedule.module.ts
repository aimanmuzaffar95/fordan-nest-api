import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { PermissionsModule } from '../permissions/permissions.module';
import { User } from '../users/entities/user.entity';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Assignment, User]),
    RuntimeSettingsModule,
    PermissionsModule,
  ],
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
