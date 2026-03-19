import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity';
import { CustomerJobsController } from './customer-jobs.controller';
import { JobAuditLog } from './entities/job-audit-log.entity';
import { Job } from './entities/job.entity';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, JobAuditLog, User, Customer]),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'development-secret',
    }),
  ],
  controllers: [JobsController, CustomerJobsController],
  providers: [JobsService, JwtAuthGuard, RolesGuard],
  exports: [JobsService],
})
export class JobsModule {}
