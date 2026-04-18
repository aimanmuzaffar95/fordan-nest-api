export const CRM_BRANDING_OWNER_TYPE = 'crm_branding';
/** Fixed UUID — `files.ownerId` is typed as uuid in the schema. */
export const CRM_BRANDING_OWNER_ID = '00000000-0000-4000-8000-000000000001';

export enum CrmBrandingUploadSlot {
  logo = 'logo',
  favicon = 'favicon',
}

export const CRM_BRANDING_FILE_KIND: Record<CrmBrandingUploadSlot, string> = {
  [CrmBrandingUploadSlot.logo]: 'branding_logo',
  [CrmBrandingUploadSlot.favicon]: 'branding_favicon',
};

export const CRM_BRANDING_LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

export const CRM_BRANDING_FAVICON_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
] as const;

/** Small assets — keep favicon loads fast. */
export const CRM_BRANDING_MAX_FILE_BYTES = 2 * 1024 * 1024;
