import { BadRequestException } from '@nestjs/common';
import { DEFAULT_COMPANY_PROFILE_SETTINGS } from './company-profile.defaults';
import type { CompanyProfileSettings } from './company-profile.types';

function cloneDefaults(): CompanyProfileSettings {
  return { ...DEFAULT_COMPANY_PROFILE_SETTINGS };
}

/** Merge stored JSON from DB with code defaults (forward-compatible). */
export function mergeCompanyProfileSettings(
  stored: unknown,
): CompanyProfileSettings {
  const base = cloneDefaults();
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return base;
  }
  return { ...base, ...(stored as Partial<CompanyProfileSettings>) };
}

export function mergeCompanyProfilePatch(
  current: CompanyProfileSettings,
  patch: unknown,
): CompanyProfileSettings {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new BadRequestException('companyProfileSettings must be an object');
  }
  return { ...current, ...(patch as Partial<CompanyProfileSettings>) };
}
