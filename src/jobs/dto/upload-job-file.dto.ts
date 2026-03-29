import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ALLOWED_UPLOAD_KINDS } from '../../files/upload.constants';

export class UploadJobFileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName: string;

  @IsOptional()
  @IsIn(ALLOWED_UPLOAD_KINDS)
  kind?: string;
}
