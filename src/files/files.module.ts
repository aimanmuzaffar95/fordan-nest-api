import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { Job } from '../jobs/entities/job.entity';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { User } from '../users/entities/user.entity';
import { File as FileEntity } from './entities/file.entity';
import { FilesService } from './files.service';
import { FilesStorageService } from './files-storage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Assignment,
      FileEntity,
      Job,
      MeterApplication,
      TimelineEvent,
      User,
    ]),
  ],
  providers: [FilesService, FilesStorageService],
  exports: [FilesService],
})
export class FilesModule {}
