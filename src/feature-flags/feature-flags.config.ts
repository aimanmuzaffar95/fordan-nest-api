import { BadRequestException } from '@nestjs/common';
import { UserRole } from '../users/entities/user-role.enum';

/**
 * Settings-backed feature flags (PRD v2 roadmap, Phase 0 enabler).
 *
 * Every later roadmap module ships behind one of these so it can be enabled
 * per-role after staging sign-off without a redeploy. A flag is `enabled` plus
 * an optional role allow-list — an empty/absent `roles` list means "all roles".
 *
 * Unknown keys are rejected: the catalog below is the contract shared by the
 * API, the web CRM and both Flutter apps.
 */
export type FeatureFlagState = {
  enabled: boolean;
  /** Empty means every role. Ignored when `enabled` is false. */
  roles: UserRole[];
};

export type FeatureFlagKey =
  // Phase 0 — enablers (on by default; additive, no user-visible risk)
  | 'taskEngine'
  | 'pipelineStageTemplates'
  | 'leadAttribution'
  // Phase 1+ — off until the module lands and passes staging sign-off
  | 'territoryRouting'
  | 'qualificationWorkflow'
  | 'householdMatching'
  | 'surveyObject'
  | 'proposalVersioning'
  | 'financing'
  | 'documentTaxonomy'
  | 'projectSplit'
  | 'permitTracking'
  | 'inspectionPto'
  | 'customerPortal'
  | 'commission'
  | 'smsChannel';

export type FeatureFlags = Record<FeatureFlagKey, FeatureFlagState>;

export type FeatureFlagCatalogItem = {
  key: FeatureFlagKey;
  label: string;
  description: string;
  /** Roadmap phase this flag belongs to (0–4). */
  phase: 0 | 1 | 2 | 3 | 4;
  defaultEnabled: boolean;
};

export const FEATURE_FLAG_CATALOG: FeatureFlagCatalogItem[] = [
  {
    key: 'taskEngine',
    label: 'Task & SLA engine',
    description:
      'Stage-driven tasks with due dates, SLA countdowns and escalation.',
    phase: 0,
    defaultEnabled: true,
  },
  {
    key: 'pipelineStageTemplates',
    label: 'Configurable pipeline stages',
    description:
      'Admin-editable stage labels, colours, SLA hours and per-stage task templates.',
    phase: 0,
    defaultEnabled: true,
  },
  {
    key: 'leadAttribution',
    label: 'Lead attribution',
    description:
      'First-class lead source/medium/campaign fields and ownership history.',
    phase: 0,
    defaultEnabled: true,
  },
  {
    key: 'territoryRouting',
    label: 'Territory & routing',
    description: 'Territories, teams and round-robin lead routing.',
    phase: 1,
    defaultEnabled: false,
  },
  {
    key: 'qualificationWorkflow',
    label: 'Qualification workflow',
    description:
      'Configurable qualification forms, scores and disqualification reasons.',
    phase: 1,
    defaultEnabled: false,
  },
  {
    key: 'householdMatching',
    label: 'Household matching & merge',
    description: 'Property/household duplicate detection and audited merges.',
    phase: 1,
    defaultEnabled: false,
  },
  {
    key: 'surveyObject',
    label: 'Site survey',
    description:
      'Survey object with roof/shading/switchboard capture and offline mobile support.',
    phase: 2,
    defaultEnabled: false,
  },
  {
    key: 'proposalVersioning',
    label: 'Proposal versioning',
    description:
      'Proposal version history plus send/view/expiry/accept tracking.',
    phase: 2,
    defaultEnabled: false,
  },
  {
    key: 'financing',
    label: 'Financing workflow',
    description:
      'Lender products and financing applications with approval tracking.',
    phase: 2,
    defaultEnabled: false,
  },
  {
    key: 'documentTaxonomy',
    label: 'Document taxonomy',
    description:
      'Document categories, tags, required-by-stage rules and versioning.',
    phase: 2,
    defaultEnabled: false,
  },
  {
    key: 'projectSplit',
    label: 'Project entity (Opportunity/Project split)',
    description:
      'Auto-create a Project on contract sign and move execution stages onto it.',
    phase: 3,
    defaultEnabled: false,
  },
  {
    key: 'permitTracking',
    label: 'Permit tracking',
    description:
      'Generic permit entity with authority, filing dates and resubmissions.',
    phase: 3,
    defaultEnabled: false,
  },
  {
    key: 'inspectionPto',
    label: 'Inspection / interconnection / PTO',
    description:
      'Inspection, interconnection and permission-to-operate milestones.',
    phase: 3,
    defaultEnabled: false,
  },
  {
    key: 'customerPortal',
    label: 'Customer portal',
    description: 'Customer-facing milestone timeline and status visibility.',
    phase: 4,
    defaultEnabled: false,
  },
  {
    key: 'commission',
    label: 'Commission & payout',
    description: 'Commission events, payable status, overrides and clawbacks.',
    phase: 4,
    defaultEnabled: false,
  },
  {
    key: 'smsChannel',
    label: 'SMS & call logging',
    description: 'SMS and call activity in the unified customer timeline.',
    phase: 4,
    defaultEnabled: false,
  },
];

export const FEATURE_FLAG_KEYS: FeatureFlagKey[] = FEATURE_FLAG_CATALOG.map(
  (f) => f.key,
);

const FEATURE_FLAG_KEY_SET = new Set<string>(FEATURE_FLAG_KEYS);

const ALL_ROLES = new Set<string>(Object.values(UserRole));

export function defaultFeatureFlags(): FeatureFlags {
  const out = {} as FeatureFlags;
  for (const item of FEATURE_FLAG_CATALOG) {
    out[item.key] = { enabled: item.defaultEnabled, roles: [] };
  }
  return out;
}

function normalizeState(
  raw: unknown,
  fallback: FeatureFlagState,
): FeatureFlagState {
  if (typeof raw === 'boolean') return { enabled: raw, roles: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  const r = raw as Record<string, unknown>;
  const enabled = typeof r.enabled === 'boolean' ? r.enabled : fallback.enabled;
  const roles = Array.isArray(r.roles)
    ? Array.from(
        new Set(
          r.roles.filter(
            (role): role is UserRole =>
              typeof role === 'string' && ALL_ROLES.has(role),
          ),
        ),
      )
    : [];
  return { enabled, roles };
}

/** Merge stored JSON with code defaults (forward-compatible). */
export function mergeFeatureFlags(stored: unknown): FeatureFlags {
  const defaults = defaultFeatureFlags();
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return defaults;
  }
  const s = stored as Record<string, unknown>;
  const out = {} as FeatureFlags;
  for (const key of FEATURE_FLAG_KEYS) {
    out[key] = normalizeState(s[key], defaults[key]);
  }
  return out;
}

export function validateFeatureFlags(flags: FeatureFlags): void {
  for (const key of FEATURE_FLAG_KEYS) {
    const state = flags[key];
    if (!state || typeof state.enabled !== 'boolean') {
      throw new BadRequestException(
        `featureFlags.${key}.enabled must be a boolean`,
      );
    }
    if (!Array.isArray(state.roles) || state.roles.length > ALL_ROLES.size) {
      throw new BadRequestException(
        `featureFlags.${key}.roles must be a role array`,
      );
    }
    for (const role of state.roles) {
      if (!ALL_ROLES.has(role)) {
        throw new BadRequestException(
          `featureFlags.${key}.roles contains unknown role "${role}"`,
        );
      }
    }
  }
}

/** Apply a partial patch: only the supplied keys change. */
export function mergeFeatureFlagsPatch(
  current: FeatureFlags,
  patch: unknown,
): FeatureFlags {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new BadRequestException('featureFlags must be an object');
  }
  const p = patch as Record<string, unknown>;
  const unknownKeys = Object.keys(p).filter(
    (k) => !FEATURE_FLAG_KEY_SET.has(k),
  );
  if (unknownKeys.length > 0) {
    throw new BadRequestException(
      `Unknown feature flag(s): ${unknownKeys.join(', ')}`,
    );
  }
  const next = { ...current };
  for (const key of FEATURE_FLAG_KEYS) {
    if (p[key] === undefined) continue;
    next[key] = normalizeState(p[key], current[key]);
  }
  return next;
}

/** Is `key` on for `role`? A flag with no role list applies to everyone. */
export function isFeatureEnabled(
  flags: FeatureFlags,
  key: FeatureFlagKey,
  role?: UserRole,
): boolean {
  const state = flags[key];
  if (!state?.enabled) return false;
  if (state.roles.length === 0) return true;
  if (!role) return false;
  return state.roles.includes(role);
}

/** Flat `{key: boolean}` view for a specific role — what clients consume. */
export function resolveFeatureFlagsForRole(
  flags: FeatureFlags,
  role?: UserRole,
): Record<FeatureFlagKey, boolean> {
  const out = {} as Record<FeatureFlagKey, boolean>;
  for (const key of FEATURE_FLAG_KEYS) {
    out[key] = isFeatureEnabled(flags, key, role);
  }
  return out;
}
