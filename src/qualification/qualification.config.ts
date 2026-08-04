import { BadRequestException } from '@nestjs/common';

/**
 * Admin-configurable lead qualification (PRD v2 Phase 1).
 *
 * Reuses the compliance-template JSON-form pattern: a list of scored criteria
 * plus a disqualification-reason vocabulary, stored on `admin_settings` and
 * merged with code defaults so an empty database behaves sensibly.
 */

export type QualificationCriterionType = 'boolean' | 'choice' | 'number';

export type QualificationChoice = {
  value: string;
  label: string;
  /** Points awarded when this choice is selected. */
  score: number;
};

export type QualificationCriterion = {
  id: string;
  label: string;
  description?: string;
  type: QualificationCriterionType;
  /** A blank answer blocks qualifying. */
  required: boolean;
  /** `boolean`: points when true. `number`: points per unit, capped by `max`. */
  score: number;
  /** `choice` only. */
  choices?: QualificationChoice[];
  /** `number` only — clamps the contribution so one field can't dominate. */
  max?: number;
};

export type QualificationConfig = {
  criteria: QualificationCriterion[];
  /** Total score at or above which a lead is considered qualified. */
  qualifiedThreshold: number;
  /** Reasons offered when disqualifying. */
  disqualificationReasons: string[];
  /**
   * Days a nurture lead waits before it resurfaces as a follow-up task.
   * Null disables the nurture path.
   */
  nurtureFollowUpDays: number | null;
};

export const DEFAULT_QUALIFICATION_CONFIG: QualificationConfig = {
  qualifiedThreshold: 60,
  nurtureFollowUpDays: 30,
  criteria: [
    {
      id: 'owns_property',
      label: 'Owns the property',
      description: 'Tenants cannot authorise an install.',
      type: 'boolean',
      required: true,
      score: 25,
    },
    {
      id: 'roof_suitable',
      label: 'Roof is suitable',
      description: 'Type, age and orientation look workable.',
      type: 'boolean',
      required: true,
      score: 20,
    },
    {
      id: 'decision_maker',
      label: 'Speaking with the decision maker',
      type: 'boolean',
      required: false,
      score: 15,
    },
    {
      id: 'budget_band',
      label: 'Budget band',
      type: 'choice',
      required: false,
      score: 0,
      choices: [
        { value: 'under_5k', label: 'Under $5k', score: 0 },
        { value: '5k_10k', label: '$5k – $10k', score: 10 },
        { value: '10k_20k', label: '$10k – $20k', score: 20 },
        { value: 'over_20k', label: 'Over $20k', score: 25 },
      ],
    },
    {
      id: 'timeframe',
      label: 'Purchase timeframe',
      type: 'choice',
      required: false,
      score: 0,
      choices: [
        { value: 'now', label: 'Ready now', score: 15 },
        { value: '3_months', label: 'Within 3 months', score: 10 },
        { value: '6_months', label: 'Within 6 months', score: 5 },
        { value: 'researching', label: 'Just researching', score: 0 },
      ],
    },
  ],
  disqualificationReasons: [
    'Renting / not the owner',
    'Roof unsuitable',
    'Out of service area',
    'Budget too low',
    'Went with a competitor',
    'No longer interested',
    'Unable to contact',
    'Duplicate enquiry',
  ],
};

const ID_PATTERN = /^[a-z0-9_-]+$/i;
const MAX_CRITERIA = 40;
const MAX_CHOICES = 20;
const MAX_REASONS = 40;
const TYPES: QualificationCriterionType[] = ['boolean', 'choice', 'number'];

function cloneDefaults(): QualificationConfig {
  return JSON.parse(
    JSON.stringify(DEFAULT_QUALIFICATION_CONFIG),
  ) as QualificationConfig;
}

function normalizeChoice(raw: unknown): QualificationChoice | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const value = typeof r.value === 'string' ? r.value.trim() : '';
  const label = typeof r.label === 'string' ? r.label.trim() : '';
  if (!value || !label) return null;
  const score = Number(r.score);
  return {
    value,
    label,
    score: Number.isFinite(score) ? Math.round(score) : 0,
  };
}

function normalizeCriterion(raw: unknown): QualificationCriterion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const label = typeof r.label === 'string' ? r.label.trim() : '';
  if (!id || !label) return null;
  const type = TYPES.includes(r.type as QualificationCriterionType)
    ? (r.type as QualificationCriterionType)
    : 'boolean';
  const score = Number(r.score);
  const max = Number(r.max);
  const description =
    typeof r.description === 'string' && r.description.trim() !== ''
      ? r.description.trim()
      : undefined;
  const choices =
    type === 'choice' && Array.isArray(r.choices)
      ? r.choices
          .map(normalizeChoice)
          .filter((c): c is QualificationChoice => c !== null)
      : undefined;
  return {
    id,
    label,
    ...(description !== undefined ? { description } : {}),
    type,
    required: r.required === true,
    score: Number.isFinite(score) ? Math.round(score) : 0,
    ...(choices ? { choices } : {}),
    ...(type === 'number' && Number.isFinite(max)
      ? { max: Math.round(max) }
      : {}),
  };
}

export function mergeQualificationConfig(stored: unknown): QualificationConfig {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return cloneDefaults();
  }
  const s = stored as Record<string, unknown>;
  const rawCriteria = s.criteria;
  const criteria = Array.isArray(rawCriteria)
    ? rawCriteria
        .map(normalizeCriterion)
        .filter((c): c is QualificationCriterion => c !== null)
    : [];
  if (criteria.length === 0) return cloneDefaults();

  const threshold = Number(s.qualifiedThreshold);
  const nurture = s.nurtureFollowUpDays;

  return {
    criteria,
    qualifiedThreshold: Number.isFinite(threshold)
      ? Math.round(threshold)
      : DEFAULT_QUALIFICATION_CONFIG.qualifiedThreshold,
    disqualificationReasons: Array.isArray(s.disqualificationReasons)
      ? s.disqualificationReasons
          .filter((r): r is string => typeof r === 'string')
          .map((r) => r.trim())
          .filter((r) => r !== '')
      : [...DEFAULT_QUALIFICATION_CONFIG.disqualificationReasons],
    nurtureFollowUpDays:
      nurture === null
        ? null
        : Number.isFinite(Number(nurture))
          ? Math.round(Number(nurture))
          : DEFAULT_QUALIFICATION_CONFIG.nurtureFollowUpDays,
  };
}

export function validateQualificationConfig(config: QualificationConfig): void {
  if (!Array.isArray(config.criteria) || config.criteria.length === 0) {
    throw new BadRequestException(
      'qualificationConfig.criteria must be a non-empty array',
    );
  }
  if (config.criteria.length > MAX_CRITERIA) {
    throw new BadRequestException(
      `qualificationConfig.criteria allows at most ${MAX_CRITERIA} entries`,
    );
  }
  const seen = new Set<string>();
  for (const c of config.criteria) {
    if (!c.id || c.id.length > 64 || !ID_PATTERN.test(c.id)) {
      throw new BadRequestException(
        `Criterion id "${c.id}" must be 1-64 chars of letters, digits, "_" or "-"`,
      );
    }
    if (seen.has(c.id)) {
      throw new BadRequestException(`Duplicate criterion id "${c.id}"`);
    }
    seen.add(c.id);
    if (!c.label || c.label.length > 160) {
      throw new BadRequestException(
        `Criterion "${c.id}" label is required (max 160 chars)`,
      );
    }
    if (!TYPES.includes(c.type)) {
      throw new BadRequestException(`Criterion "${c.id}" has an unknown type`);
    }
    if (!Number.isInteger(c.score) || c.score < -100 || c.score > 100) {
      throw new BadRequestException(
        `Criterion "${c.id}" score must be an integer between -100 and 100`,
      );
    }
    if (c.type === 'choice') {
      if (!Array.isArray(c.choices) || c.choices.length === 0) {
        throw new BadRequestException(
          `Criterion "${c.id}" is a choice and needs at least one option`,
        );
      }
      if (c.choices.length > MAX_CHOICES) {
        throw new BadRequestException(
          `Criterion "${c.id}" allows at most ${MAX_CHOICES} options`,
        );
      }
      const values = new Set<string>();
      for (const choice of c.choices) {
        if (values.has(choice.value)) {
          throw new BadRequestException(
            `Criterion "${c.id}" has duplicate option "${choice.value}"`,
          );
        }
        values.add(choice.value);
      }
    }
  }
  if (
    !Number.isInteger(config.qualifiedThreshold) ||
    config.qualifiedThreshold < 0
  ) {
    throw new BadRequestException(
      'qualificationConfig.qualifiedThreshold must be a non-negative integer',
    );
  }
  if (config.disqualificationReasons.length > MAX_REASONS) {
    throw new BadRequestException(
      `qualificationConfig.disqualificationReasons allows at most ${MAX_REASONS} entries`,
    );
  }
  if (
    config.nurtureFollowUpDays !== null &&
    (!Number.isInteger(config.nurtureFollowUpDays) ||
      config.nurtureFollowUpDays < 1 ||
      config.nurtureFollowUpDays > 365)
  ) {
    throw new BadRequestException(
      'qualificationConfig.nurtureFollowUpDays must be null or 1–365',
    );
  }
}

export function mergeQualificationPatch(
  current: QualificationConfig,
  patch: unknown,
): QualificationConfig {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new BadRequestException('qualificationConfig must be an object');
  }
  const allowed = new Set([
    'criteria',
    'qualifiedThreshold',
    'disqualificationReasons',
    'nurtureFollowUpDays',
  ]);
  const unknownKeys = Object.keys(patch).filter((k) => !allowed.has(k));
  if (unknownKeys.length > 0) {
    throw new BadRequestException(
      `Unknown qualificationConfig key(s): ${unknownKeys.join(', ')}`,
    );
  }
  // Every key is replace-not-merge: the editor always sends whole lists.
  return mergeQualificationConfig({ ...current, ...patch });
}

/**
 * Score a set of answers against the config.
 *
 * Unknown answer keys are ignored rather than rejected, so a criterion that is
 * removed from the config doesn't invalidate history already recorded.
 */
export function scoreQualification(
  config: QualificationConfig,
  answers: Record<string, unknown>,
): { score: number; missingRequired: string[] } {
  let score = 0;
  const missingRequired: string[] = [];

  for (const criterion of config.criteria) {
    const answer = answers[criterion.id];
    const answered = answer !== undefined && answer !== null && answer !== '';

    if (!answered) {
      if (criterion.required) missingRequired.push(criterion.id);
      continue;
    }

    switch (criterion.type) {
      case 'boolean':
        if (answer === true) score += criterion.score;
        break;
      case 'choice': {
        const choice = criterion.choices?.find((c) => c.value === answer);
        if (choice) score += choice.score;
        break;
      }
      case 'number': {
        const value = Number(answer);
        if (!Number.isFinite(value)) break;
        const raw = value * criterion.score;
        score +=
          criterion.max !== undefined ? Math.min(raw, criterion.max) : raw;
        break;
      }
    }
  }

  return { score: Math.round(score), missingRequired };
}

/**
 * Answers that do not fit their criterion, as human-readable messages.
 *
 * `scoreQualification` deliberately ignores anything it cannot score, which
 * silently stores junk from API and mobile clients and reports a 0 for that
 * criterion as though it had been answered badly rather than invalidly.
 * Callers validate at the boundary instead; scoring stays pure.
 */
export function validateQualificationAnswers(
  config: QualificationConfig,
  answers: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const byId = new Map(config.criteria.map((c) => [c.id, c]));

  for (const [id, answer] of Object.entries(answers)) {
    if (answer === undefined || answer === null || answer === '') continue;

    const criterion = byId.get(id);
    if (!criterion) {
      errors.push(`Unknown qualification criterion "${id}"`);
      continue;
    }

    switch (criterion.type) {
      case 'boolean':
        if (typeof answer !== 'boolean') {
          errors.push(`"${id}" must be true or false`);
        }
        break;
      case 'choice': {
        const allowed = (criterion.choices ?? []).map((c) => c.value);
        if (typeof answer !== 'string' || !allowed.includes(answer)) {
          errors.push(`"${id}" must be one of: ${allowed.join(', ')}`);
        }
        break;
      }
      case 'number':
        if (!Number.isFinite(Number(answer))) {
          errors.push(`"${id}" must be a number`);
        }
        break;
    }
  }

  return errors;
}
