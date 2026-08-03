import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from '../jobs/entities/job.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { TerritoriesModule } from '../territories/territories.module';
import { ProposalsModule } from '../proposals/proposals.module';
import { FinancingModule } from '../financing/financing.module';
import { Task } from './entities/task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, Job, User]),
    NotificationsModule,
    RuntimeSettingsModule,
    TerritoriesModule,
    ProposalsModule,
    FinancingModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
