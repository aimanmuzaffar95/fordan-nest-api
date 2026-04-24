import { BadRequestException } from '@nestjs/common';
import { DEFAULT_BILLING_SETTINGS } from './billing-settings.defaults';
import type { BillingSettings } from './billing-settings.types';

function normalizeNullableString(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

export function normalizeBillingSettings(s: BillingSettings): BillingSettings {
  const def = DEFAULT_BILLING_SETTINGS;
  const rate =
    typeof s.defaultTaxRatePercent === 'number' &&
    Number.isFinite(s.defaultTaxRatePercent)
      ? s.defaultTaxRatePercent
      : def.defaultTaxRatePercent;
  return {
    ...s,
    defaultTaxRatePercent: Math.min(100, Math.max(0, rate)),
    paymentInstructions: normalizeNullableString(s.paymentInstructions, 4000),
    invoiceFooterNote: normalizeNullableString(s.invoiceFooterNote, 4000),
  };
}

export function validateBillingSettings(s: BillingSettings): void {
  if (
    typeof s.defaultTaxRatePercent !== 'number' ||
    !Number.isFinite(s.defaultTaxRatePercent) ||
    s.defaultTaxRatePercent < 0 ||
    s.defaultTaxRatePercent > 100
  ) {
    throw new BadRequestException(
      'billingSettings.defaultTaxRatePercent must be a number from 0 to 100',
    );
  }
}
