import { BadRequestException } from '@nestjs/common';
import { resolveUploadsConfig } from './uploads.config';

type UploadFileFilterCallback = (
  error: Error | null,
  acceptFile: boolean,
) => void;

const configuredAllowedMimeTypes = resolveUploadsConfig().allowedMimeTypes;

export const uploadFileFilter =
  (allowedMimeTypes: readonly string[] = configuredAllowedMimeTypes) =>
  (_req: unknown, file: { mimetype: string }, cb: UploadFileFilterCallback) => {
    const mime = file.mimetype.trim().toLowerCase();
    const isAllowed = allowedMimeTypes.some(
      (allowedMimeType) => allowedMimeType === mime,
    );

    if (!isAllowed) {
      cb(
        new BadRequestException(`Unsupported file type: ${file.mimetype}`),
        false,
      );
      return;
    }

    cb(null, true);
  };
