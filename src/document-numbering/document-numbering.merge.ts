import { BadRequestException } from '@nestjs/common';
import { DEFAULT_DOCUMENT_NUMBERING_SETTINGS } from './document-numbering.defaults';
import type { DocumentNumberingSettings } from './document-numbering.types';

function cloneDefaults(): DocumentNumberingSettings {
  return { ...DEFAULT_DOCUMENT_NUMBERING_SETTINGS };
}

/** Merge stored JSON from DB with code defaults (forward-compatible). */
export function mergeDocumentNumberingSettings(
  stored: unknown,
): DocumentNumberingSettings {
  const base = cloneDefaults();
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return base;
  }
  return { ...base, ...(stored as Partial<DocumentNumberingSettings>) };
}

export function mergeDocumentNumberingPatch(
  current: DocumentNumberingSettings,
  patch: unknown,
): DocumentNumberingSettings {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new BadRequestException(
      'documentNumberingSettings must be an object',
    );
  }
  return { ...current, ...(patch as Partial<DocumentNumberingSettings>) };
}
