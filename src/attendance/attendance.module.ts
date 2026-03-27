import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { Job } from '../jobs/entities/job.entity';
import { JobsModule } from '../jobs/jobs.module';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { User } from '../users/entities/user.entity';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceSession } from './entities/attendance-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AttendanceSession, Assignment, Job, User]),
    JobsModule,
    RuntimeSettingsModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
