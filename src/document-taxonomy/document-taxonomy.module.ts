import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { File as FileEntity } from '../files/entities/file.entity';
import { Job } from '../jobs/entities/job.entity';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { DocumentTaxonomyController } from './document-taxonomy.controller';
import { DocumentTaxonomyService } from './document-taxonomy.service';

@Module({
  imports: [TypeOrmModule.forFeature([FileEntity, Job]), RuntimeSettingsModule],
  controllers: [DocumentTaxonomyController],
  providers: [DocumentTaxonomyService],
  exports: [DocumentTaxonomyService],
})
export class DocumentTaxonomyModule {}
