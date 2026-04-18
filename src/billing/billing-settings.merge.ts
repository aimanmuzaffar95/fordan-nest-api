import { BadRequestException } from '@nestjs/common';
import { DEFAULT_BILLING_SETTINGS } from './billing-settings.defaults';
import type { BillingSettings } from './billing-settings.types';

function cloneDefaults(): BillingSettings {
  return { ...DEFAULT_BILLING_SETTINGS };
}

/** Merge stored JSON from DB with code defaults (forward-compatible). */
export function mergeBillingSettings(stored: unknown): BillingSettings {
  const base = cloneDefaults();
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return base;
  }
  return { ...base, ...(stored as Partial<BillingSettings>) };
}

export function mergeBillingPatch(
  current: BillingSettings,
  patch: unknown,
): BillingSettings {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new BadRequestException('billingSettings must be an object');
  }
  return { ...current, ...(patch as Partial<BillingSettings>) };
}
