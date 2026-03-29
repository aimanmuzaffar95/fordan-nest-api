import { IsIn, IsOptional } from 'class-validator';
import { ALLOWED_UPLOAD_KINDS } from '../upload.constants';

export class UploadOwnedFileDto {
  @IsOptional()
  @IsIn(ALLOWED_UPLOAD_KINDS)
  kind?: string;
}
