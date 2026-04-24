import { BadRequestException } from '@nestjs/common';
import { DEFAULT_COMPANY_PROFILE_SETTINGS } from './company-profile.defaults';
import type { CompanyProfileSettings } from './company-profile.types';

const CURRENCY_RE = /^[A-Z]{3}$/;

function normalizeNullableString(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function assertOptionalHttpUrl(label: string, v: string | null): void {
  if (!v) return;
  if (v.length > 2048) {
    throw new BadRequestException(`${label} is too long (max 2048 characters)`);
  }
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new BadRequestException(`${label} must be an http(s) URL`);
    }
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException(`${label} must be a valid http(s) URL`);
  }
}

function assertOptionalEmail(label: string, v: string | null): void {
  if (!v) return;
  // Keep it lightweight; stricter validation happens at the email send boundary.
  if (!v.includes('@') || v.length > 320) {
    throw new BadRequestException(`${label} must be a valid email address`);
  }
}

export function normalizeCompanyProfileSettings(
  s: CompanyProfileSettings,
): CompanyProfileSettings {
  const def = DEFAULT_COMPANY_PROFILE_SETTINGS;
  const legal = typeof s.legalName === 'string' ? s.legalName.trim() : '';
  return {
    ...s,
    legalName: legal || def.legalName,
    tradingName: normalizeNullableString(s.tradingName, 120),
    abn: normalizeNullableString(s.abn, 32),
    acn: normalizeNullableString(s.acn, 32),
    supportEmail: normalizeNullableString(s.supportEmail, 320),
    supportPhone: normalizeNullableString(s.supportPhone, 64),
    websiteUrl: normalizeNullableString(s.websiteUrl, 2048),
    addressLine1: normalizeNullableString(s.addressLine1, 160),
    addressLine2: normalizeNullableString(s.addressLine2, 160),
    suburb: normalizeNullableString(s.suburb, 100),
    state: normalizeNullableString(s.state, 100),
    postcode: normalizeNullableString(s.postcode, 24),
    country: normalizeNullableString(s.country, 100) ?? def.country,
    timezone:
      typeof s.timezone === 'string' && s.timezone.trim()
        ? s.timezone.trim()
        : def.timezone,
    currency:
      typeof s.currency === 'string' && s.currency.trim()
        ? s.currency.trim().toUpperCase()
        : def.currency,
  };
}

export function validateCompanyProfileSettings(
  s: CompanyProfileSettings,
): void {
  if (typeof s.legalName !== 'string' || !s.legalName.trim()) {
    throw new BadRequestException(
      'companyProfileSettings.legalName is required and must be non-empty',
    );
  }
  if (s.legalName.length > 160) {
    throw new BadRequestException(
      'companyProfileSettings.legalName must be at most 160 characters',
    );
  }
  assertOptionalEmail('companyProfileSettings.supportEmail', s.supportEmail);
  assertOptionalHttpUrl('companyProfileSettings.websiteUrl', s.websiteUrl);
  if (!CURRENCY_RE.test(s.currency)) {
    throw new BadRequestException(
      'companyProfileSettings.currency must be a 3-letter code (e.g. AUD)',
    );
  }
  if (s.timezone.length > 64) {
    throw new BadRequestException(
      'companyProfileSettings.timezone must be at most 64 characters',
    );
  }
}
