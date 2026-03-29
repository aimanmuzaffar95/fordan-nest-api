import {
  DEFAULT_ALLOWED_UPLOAD_MIME_TYPES,
  DEFAULT_MAX_UPLOAD_SIZE_BYTES,
} from './upload.constants';

export type StorageDriver = 'local' | 's3';

export type UploadsConfig = {
  driver: StorageDriver;
  localUploadDir: string;
  maxUploadSizeBytes: number;
  allowedMimeTypes: string[];
  uploadsEnv: 'dev' | 'staging' | 'prod';
  s3: {
    endpoint?: string;
    region: string;
    fileUploadsBucket: string;
    complianceUploadsBucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    autoCreateBucket: boolean;
  };
};

const envBool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const envNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

export const resolveUploadsConfig = (): UploadsConfig => {
  const driverRaw = (process.env.STORAGE_DRIVER ?? 'local')
    .trim()
    .toLowerCase();
  const driver: StorageDriver = driverRaw === 's3' ? 's3' : 'local';
  const nodeEnv = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const uploadsEnvRaw = (process.env.UPLOADS_ENV ?? '').trim().toLowerCase();
  const uploadsEnv: 'dev' | 'staging' | 'prod' =
    uploadsEnvRaw === 'staging'
      ? 'staging'
      : uploadsEnvRaw === 'prod' || uploadsEnvRaw === 'production'
        ? 'prod'
        : 'dev';

  const allowedMimeTypes = (
    process.env.UPLOAD_ALLOWED_MIME_TYPES ??
    DEFAULT_ALLOWED_UPLOAD_MIME_TYPES.join(',')
  )
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const s3Endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const s3Region = process.env.S3_REGION?.trim() || 'us-east-1';
  const legacyBucket = process.env.S3_BUCKET?.trim() || '';
  const fileUploadsBucket =
    process.env.S3_FILE_UPLOADS_BUCKET?.trim() ||
    legacyBucket ||
    `file-uploads-${uploadsEnv}`;
  const complianceUploadsBucket =
    process.env.S3_COMPLIANCE_UPLOADS_BUCKET?.trim() ||
    `compliance-uploads-${uploadsEnv}`;
  const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID?.trim() || '';
  const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim() || '';

  return {
    driver,
    localUploadDir: process.env.LOCAL_UPLOAD_DIR?.trim() || './uploads',
    maxUploadSizeBytes: envNumber(
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES,
      DEFAULT_MAX_UPLOAD_SIZE_BYTES,
    ),
    allowedMimeTypes,
    uploadsEnv,
    s3: {
      endpoint: s3Endpoint,
      region: s3Region,
      fileUploadsBucket,
      complianceUploadsBucket,
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      forcePathStyle: envBool(process.env.S3_FORCE_PATH_STYLE, !!s3Endpoint),
      autoCreateBucket: envBool(
        process.env.S3_AUTO_CREATE_BUCKET,
        nodeEnv !== 'production',
      ),
    },
  };
};
