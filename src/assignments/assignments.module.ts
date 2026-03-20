import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '../jobs/jobs.module';
import { Team } from '../teams/entities/team.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { User } from '../users/entities/user.entity';
import { Assignment } from './entities/assignment.entity';
import { AssignmentsService } from './assignments.service';
import { AssignmentsLockController } from './assignments-lock.controller';
import { JobAssignmentsController } from './job-assignments.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Assignment, Team, User, TimelineEvent]),
    JobsModule,
  ],
  controllers: [JobAssignmentsController, AssignmentsLockController],
  providers: [AssignmentsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
