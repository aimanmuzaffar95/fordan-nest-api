import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { TasksModule } from '../tasks/tasks.module';
import { InstallDefect, InstallVisit } from './entities/install-visit.entity';
import { Permit } from './entities/permit.entity';
import { ProjectMilestone } from './entities/project-milestone.entity';
import { ProjectNote } from './entities/project-note.entity';
import { Project } from './entities/project.entity';
import { InstallExecutionService } from './install-execution.service';
import { MilestonesService } from './milestones.service';
import { PermitsService } from './permits.service';
import { ProjectNotesService } from './project-notes.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      Permit,
      ProjectMilestone,
      ProjectNote,
      InstallVisit,
      InstallDefect,
      Job,
      Customer,
      Assignment,
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
    ProjectNotesService,
  ],
  exports: [ProjectsService, PermitsService],
})
export class ProjectsModule {}
