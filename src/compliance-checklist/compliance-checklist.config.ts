import { BadRequestException } from '@nestjs/common';

/**
 * Admin-configurable CEC compliance checklist (Settings → Compliance).
 * Single source of truth read by both the web CRM and the mobile app;
 * defaults mirror the checklist previously hardcoded in the mobile app.
 */
export type ComplianceChecklistItemConfig = {
  /** Stable id. Known ids (cec_*) keep their smart status derivation on mobile. */
  id: string;
  label: string;
  description?: string;
  required: boolean;
  /**
   * Lowercase keywords matched against submitted compliance form template
   * names; a match marks this checklist item done.
   */
  docTemplateKeywords?: string[];
};

export type ComplianceChecklistConfig = {
  items: ComplianceChecklistItemConfig[];
};

export const DEFAULT_COMPLIANCE_CHECKLIST_CONFIG: ComplianceChecklistConfig = {
  items: [
    {
      id: 'cec_site_access',
      label: 'Site access & customer consent',
      description: 'Confirm access before mobilising crew',
      required: true,
    },
    {
      id: 'cec_swms',
      label: 'SWMS & pre-install safety',
      description: 'Safe work method statement on file',
      required: true,
      docTemplateKeywords: ['swms', 'safety', 'pre-install', 'pre install'],
    },
    {
      id: 'cec_photos',
      label: 'Site evidence photos',
      description: 'Minimum 4 photos before install sign-off',
      required: true,
    },
    {
      id: 'cec_pre_meter',
      label: 'Pre-meter grid application',
      description: 'Network operator approval before install',
      required: true,
    },
    {
      id: 'cec_install_signoff',
      label: 'Installation sign-off',
      description: 'Mark installed when work is complete',
      required: true,
    },
    {
      id: 'cec_post_meter',
      label: 'Post-meter & commissioning',
      description: 'Grid connection after install',
      required: true,
    },
    {
      id: 'cec_declaration',
      label: 'CEC compliance declaration',
      description: 'STC / CEC paperwork complete',
      required: true,
      docTemplateKeywords: [
        'declaration',
        'commissioning',
        'sign-off',
        'signoff',
        'sign off',
        'cec',
      ],
    },
  ],
};

function cloneDefaults(): ComplianceChecklistConfig {
  return JSON.parse(
    JSON.stringify(DEFAULT_COMPLIANCE_CHECKLIST_CONFIG),
  ) as ComplianceChecklistConfig;
}

const MAX_ITEMS = 50;
const ID_PATTERN = /^[a-z0-9_-]+$/i;

function normalizeItem(raw: unknown): ComplianceChecklistItemConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const label = typeof r.label === 'string' ? r.label.trim() : '';
  if (!id || !label) return null;
  const description =
    typeof r.description === 'string' && r.description.trim() !== ''
      ? r.description.trim()
      : undefined;
  const keywords = Array.isArray(r.docTemplateKeywords)
    ? r.docTemplateKeywords
        .filter((k): k is string => typeof k === 'string')
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k !== '')
    : undefined;
  return {
    id,
    label,
    ...(description !== undefined ? { description } : {}),
    required: r.required !== false,
    ...(keywords && keywords.length > 0
      ? { docTemplateKeywords: keywords }
      : {}),
  };
}

/** Merge stored JSON from DB with code defaults (forward-compatible). */
export function mergeComplianceChecklistConfig(
  stored: unknown,
): ComplianceChecklistConfig {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return cloneDefaults();
  }
  const rawItems = (stored as Record<string, unknown>).items;
  if (!Array.isArray(rawItems)) return cloneDefaults();
  const items = rawItems
    .map(normalizeItem)
    .filter((i): i is ComplianceChecklistItemConfig => i !== null);
  if (items.length === 0) return cloneDefaults();
  return { items };
}

export function validateComplianceChecklistConfig(
  config: ComplianceChecklistConfig,
): void {
  if (!Array.isArray(config.items) || config.items.length === 0) {
    throw new BadRequestException(
      'complianceChecklistConfig.items must be a non-empty array',
    );
  }
  if (config.items.length > MAX_ITEMS) {
    throw new BadRequestException(
      `complianceChecklistConfig.items must have at most ${MAX_ITEMS} items`,
    );
  }
  const seen = new Set<string>();
  for (const item of config.items) {
    if (!item.id || item.id.length > 64 || !ID_PATTERN.test(item.id)) {
      throw new BadRequestException(
        `Checklist item id "${item.id}" must be 1-64 chars of letters, digits, "_" or "-"`,
      );
    }
    if (seen.has(item.id)) {
      throw new BadRequestException(`Duplicate checklist item id "${item.id}"`);
    }
    seen.add(item.id);
    if (!item.label || item.label.length > 120) {
      throw new BadRequestException(
        `Checklist item "${item.id}" label is required (max 120 chars)`,
      );
    }
    if (item.description !== undefined && item.description.length > 300) {
      throw new BadRequestException(
        `Checklist item "${item.id}" description exceeds 300 chars`,
      );
    }
    if (typeof item.required !== 'boolean') {
      throw new BadRequestException(
        `Checklist item "${item.id}" required must be a boolean`,
      );
    }
    if (item.docTemplateKeywords !== undefined) {
      if (
        !Array.isArray(item.docTemplateKeywords) ||
        item.docTemplateKeywords.length > 20 ||
        item.docTemplateKeywords.some(
          (k) => typeof k !== 'string' || k.length === 0 || k.length > 60,
        )
      ) {
        throw new BadRequestException(
          `Checklist item "${item.id}" docTemplateKeywords must be up to 20 strings of max 60 chars`,
        );
      }
    }
  }
}

/**
 * Apply a client patch: the editor sends the full items list, so the patch
 * replaces items wholesale after normalization + validation.
 */
export function mergeComplianceChecklistPatch(
  current: ComplianceChecklistConfig,
  patch: unknown,
): ComplianceChecklistConfig {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new BadRequestException(
      'complianceChecklistConfig must be an object',
    );
  }
  const unknownKeys = Object.keys(patch).filter((k) => k !== 'items');
  if (unknownKeys.length > 0) {
    throw new BadRequestException(
      `Unknown complianceChecklistConfig key(s): ${unknownKeys.join(', ')}`,
    );
  }
  const rawItems = (patch as Record<string, unknown>).items;
  if (rawItems === undefined) return current;
  if (!Array.isArray(rawItems)) {
    throw new BadRequestException(
      'complianceChecklistConfig.items must be an array',
    );
  }
  const items = rawItems
    .map(normalizeItem)
    .filter((i): i is ComplianceChecklistItemConfig => i !== null);
  return { items };
}
