import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { TasksModule } from '../tasks/tasks.module';
import { InstallDefect, InstallVisit } from './entities/install-visit.entity';
import { Permit } from './entities/permit.entity';
import { ProjectMilestone } from './entities/project-milestone.entity';
import { Project } from './entities/project.entity';
import { InstallExecutionService } from './install-execution.service';
import { MilestonesService } from './milestones.service';
import { PermitsService } from './permits.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      Permit,
      ProjectMilestone,
      InstallVisit,
      InstallDefect,
      Job,
      Customer,
    ]),
    NotificationsModule,
    RuntimeSettingsModule,
    TasksModule,
  ],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    PermitsService,
    MilestonesService,
    InstallExecutionService,
  ],
  exports: [ProjectsService, PermitsService],
})
export class ProjectsModule {}
