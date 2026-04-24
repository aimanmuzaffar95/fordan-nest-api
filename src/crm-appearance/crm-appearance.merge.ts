import { BadRequestException } from '@nestjs/common';
import { DEFAULT_CRM_APPEARANCE_SETTINGS } from './crm-appearance.defaults';
import type { CrmAppearanceSettings } from './crm-appearance.types';

function cloneDefaults(): CrmAppearanceSettings {
  return { ...DEFAULT_CRM_APPEARANCE_SETTINGS };
}

/** Merge stored JSON from DB with code defaults (forward-compatible). */
export function mergeCrmAppearanceSettings(
  stored: unknown,
): CrmAppearanceSettings {
  const base = cloneDefaults();
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return base;
  }
  const s = stored as Partial<CrmAppearanceSettings>;
  return { ...base, ...s };
}

export function mergeCrmAppearancePatch(
  current: CrmAppearanceSettings,
  patch: unknown,
): CrmAppearanceSettings {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new BadRequestException('crmAppearanceSettings must be an object');
  }
  const p = patch as Partial<CrmAppearanceSettings>;
  return { ...current, ...p };
}
