import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { JobsModule } from '../jobs/jobs.module';
import { File as FileEntity } from './entities/file.entity';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FilesStorageService } from './files-storage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileEntity, MeterApplication]),
    JobsModule,
  ],
  controllers: [FilesController],
  providers: [FilesStorageService, FilesService],
  exports: [FilesService, FilesStorageService],
})
export class FilesModule {}
