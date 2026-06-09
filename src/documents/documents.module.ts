import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Assignment } from '../assignments/entities/assignment.entity';
import { FilesModule } from '../files/files.module';
import { Job } from '../jobs/entities/job.entity';
import { PermissionsModule } from '../permissions/permissions.module';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { JobDocumentSignRequest } from './entities/job-document-sign-request.entity';
import { JobGeneratedDocument } from './entities/job-generated-document.entity';
import { JobDocumentsController } from './job-documents.controller';
import { JobDocumentsPdfService } from './job-documents-pdf.service';
import { JobDocumentsService } from './job-documents.service';

@Module({
  imports: [
    AuthModule,
    FilesModule,
    PermissionsModule,
    TypeOrmModule.forFeature([
      JobGeneratedDocument,
      JobDocumentSignRequest,
      Job,
      Assignment,
      TimelineEvent,
    ]),
  ],
  controllers: [JobDocumentsController],
  providers: [JobDocumentsService, JobDocumentsPdfService, RolesGuard],
  exports: [JobDocumentsService],
})
export class DocumentsModule {}
