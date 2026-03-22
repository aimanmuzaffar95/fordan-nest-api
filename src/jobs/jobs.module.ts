import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerJobsController } from './customer-jobs.controller';
import { JobAuditLogsService } from './job-audit-logs.service';
import { JobAuditLog } from './entities/job-audit-log.entity';
import { Job } from './entities/job.entity';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { Note } from '../notes/entities/note.entity';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'development-secret',
    }),
    TypeOrmModule.forFeature([
      Job,
      JobAuditLog,
      MeterApplication,
      Customer,
      TimelineEvent,
      User,
      Note,
    ]),
  ],
  controllers: [JobsController, CustomerJobsController],
  providers: [JobsService, JobAuditLogsService],
  exports: [JobsService, JobAuditLogsService],
})
export class JobsModule {}
