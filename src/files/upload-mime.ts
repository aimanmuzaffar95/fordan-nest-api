const ALLOWED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export function normalizeMime(raw: string): string {
  return raw.toLowerCase().split(';')[0]?.trim() ?? '';
}

export function allowedUploadMime(contentType: string): string | null {
  const mime = normalizeMime(contentType);
  return ALLOWED.has(mime) ? mime : null;
}

export function extensionForMime(mime: string): string {
  switch (mime) {
    case 'application/pdf':
      return '.pdf';
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    default:
      return '.bin';
  }
}

export function maxUploadBytes(): number {
  const raw = process.env.MAX_UPLOAD_BYTES;
  if (raw === undefined || raw === '') {
    return 15 * 1024 * 1024;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 15 * 1024 * 1024;
}
