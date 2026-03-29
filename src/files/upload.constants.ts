export const ALLOWED_UPLOAD_KINDS = [
  'photos',
  'signed_paperwork',
  'meter_docs',
  'compliance',
  'other',
] as const;

export type UploadKind = (typeof ALLOWED_UPLOAD_KINDS)[number];

export const COMPLIANCE_UPLOAD_KIND: UploadKind = 'compliance';

export const DEFAULT_METER_APPLICATION_UPLOAD_KIND: UploadKind = 'meter_docs';

export const DEFAULT_ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
