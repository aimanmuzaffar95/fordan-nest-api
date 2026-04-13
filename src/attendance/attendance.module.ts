import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AdminGuard,
  InstallerGuard,
  ManagerGuard,
} from '../auth/guards/role.guards';
import { File as FileEntity } from '../files/entities/file.entity';
import { FilesModule } from '../files/files.module';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Job } from '../jobs/entities/job.entity';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { User } from '../users/entities/user.entity';
import {
  AttendanceController,
  AttendancePhotoController,
} from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceRecord } from './entities/attendance-record.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AttendanceRecord,
      Job,
      Assignment,
      FileEntity,
      TimelineEvent,
      User,
    ]),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'development-secret',
    }),
    JobsModule,
    NotificationsModule,
    FilesModule,
  ],
  controllers: [AttendanceController, AttendancePhotoController],
  providers: [
    AttendanceService,
    JwtAuthGuard,
    RolesGuard,
    AdminGuard,
    ManagerGuard,
    InstallerGuard,
  ],
})
export class AttendanceModule {}
