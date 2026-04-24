import { BadRequestException } from '@nestjs/common';
import { DEFAULT_CRM_APPEARANCE_SETTINGS } from './crm-appearance.defaults';
import type { CrmAppearanceSettings } from './crm-appearance.types';

const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

const THEMES = new Set(['system', 'light', 'dark']);

const UI_FONTS = new Set([
  'inter',
  'dm_sans',
  'plus_jakarta_sans',
  'source_sans_3',
  'nunito_sans',
  'work_sans',
  'system',
]);

const MONO_FONTS = new Set([
  'jetbrains_mono',
  'fira_code',
  'source_code_pro',
  'system',
]);

const RADIUS_PRESETS = new Set(['default', 'tight', 'round']);

function assertOptionalHttpUrl(label: string, v: string | null): void {
  if (v == null || v === '') return;
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

export function normalizeCrmAppearanceSettings(
  s: CrmAppearanceSettings,
): CrmAppearanceSettings {
  const primary = s.primaryBrandHex?.trim();
  const def = DEFAULT_CRM_APPEARANCE_SETTINGS;
  const uiOk = typeof s.uiFontId === 'string' && UI_FONTS.has(s.uiFontId);
  const monoOk =
    typeof s.monoFontId === 'string' && MONO_FONTS.has(s.monoFontId);
  const radiusOk =
    typeof s.borderRadiusPreset === 'string' &&
    RADIUS_PRESETS.has(s.borderRadiusPreset);
  return {
    ...s,
    appDisplayName: s.appDisplayName.trim(),
    loginTagline: s.loginTagline?.trim() || null,
    sidebarSubtitle: s.sidebarSubtitle?.trim() || null,
    browserTitleSuffix: s.browserTitleSuffix?.trim() || null,
    logoUrl: s.logoUrl?.trim() || null,
    faviconUrl: s.faviconUrl?.trim() || null,
    primaryBrandHex: primary && primary.length > 0 ? primary : null,
    uiFontId: uiOk ? s.uiFontId : def.uiFontId,
    monoFontId: monoOk ? s.monoFontId : def.monoFontId,
    borderRadiusPreset: radiusOk
      ? s.borderRadiusPreset
      : def.borderRadiusPreset,
  };
}

export function validateCrmAppearanceSettings(s: CrmAppearanceSettings): void {
  if (typeof s.appDisplayName !== 'string' || !s.appDisplayName.trim()) {
    throw new BadRequestException(
      'crmAppearanceSettings.appDisplayName is required and must be non-empty',
    );
  }
  if (s.appDisplayName.length > 80) {
    throw new BadRequestException(
      'crmAppearanceSettings.appDisplayName must be at most 80 characters',
    );
  }

  if (s.loginTagline != null) {
    if (typeof s.loginTagline !== 'string' || s.loginTagline.length > 240) {
      throw new BadRequestException(
        'crmAppearanceSettings.loginTagline must be a string of at most 240 characters',
      );
    }
  }

  if (s.sidebarSubtitle != null) {
    if (
      typeof s.sidebarSubtitle !== 'string' ||
      s.sidebarSubtitle.length > 120
    ) {
      throw new BadRequestException(
        'crmAppearanceSettings.sidebarSubtitle must be a string of at most 120 characters',
      );
    }
  }

  if (s.browserTitleSuffix != null) {
    if (
      typeof s.browserTitleSuffix !== 'string' ||
      s.browserTitleSuffix.length > 120
    ) {
      throw new BadRequestException(
        'crmAppearanceSettings.browserTitleSuffix must be a string of at most 120 characters',
      );
    }
  }

  assertOptionalHttpUrl('crmAppearanceSettings.logoUrl', s.logoUrl);
  assertOptionalHttpUrl('crmAppearanceSettings.faviconUrl', s.faviconUrl);

  if (s.primaryBrandHex != null && s.primaryBrandHex !== '') {
    if (
      typeof s.primaryBrandHex !== 'string' ||
      !HEX_RE.test(s.primaryBrandHex)
    ) {
      throw new BadRequestException(
        'crmAppearanceSettings.primaryBrandHex must be null or a #RGB / #RRGGBB value',
      );
    }
  }

  if (!THEMES.has(s.themePreference)) {
    throw new BadRequestException(
      'crmAppearanceSettings.themePreference must be system, light, or dark',
    );
  }

  if (typeof s.compactSidebar !== 'boolean') {
    throw new BadRequestException(
      'crmAppearanceSettings.compactSidebar must be a boolean',
    );
  }

  if (typeof s.loginHideQuickFill !== 'boolean') {
    throw new BadRequestException(
      'crmAppearanceSettings.loginHideQuickFill must be a boolean',
    );
  }

  if (!UI_FONTS.has(s.uiFontId)) {
    throw new BadRequestException(
      'crmAppearanceSettings.uiFontId is not a supported value',
    );
  }

  if (!MONO_FONTS.has(s.monoFontId)) {
    throw new BadRequestException(
      'crmAppearanceSettings.monoFontId is not a supported value',
    );
  }

  if (!RADIUS_PRESETS.has(s.borderRadiusPreset)) {
    throw new BadRequestException(
      'crmAppearanceSettings.borderRadiusPreset must be default, tight, or round',
    );
  }
}
