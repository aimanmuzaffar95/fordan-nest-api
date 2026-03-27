import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from '../jobs/entities/job.entity';
import { User } from '../users/entities/user.entity';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { StaffAvailability } from './entities/staff-availability.entity';

@Module({
  imports: [TypeOrmModule.forFeature([StaffAvailability, Job, User])],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
})
export class AvailabilityModule {}
