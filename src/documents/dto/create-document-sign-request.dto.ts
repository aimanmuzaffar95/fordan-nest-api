import { IsEmail, IsIn, ValidateIf } from 'class-validator';
import type { JobDocumentSignRequestMode } from '../entities/job-document-sign-request.entity';

export class CreateDocumentSignRequestDto {
  @IsIn(['email', 'on_device'])
  mode: JobDocumentSignRequestMode;

  @ValidateIf((dto: CreateDocumentSignRequestDto) => dto.mode === 'email')
  @IsEmail()
  recipientEmail?: string;
}
