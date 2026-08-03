import { BadRequestException } from '@nestjs/common';
import { JobPipelineStage } from '../jobs/job-pipeline-stage.enum';
import { STAGE_ORDER } from '../jobs/pipeline-gate.rules';

/**
 * Document taxonomy (PRD v2 Phase 2).
 *
 * Categories are config, not a table: the set is small, admin-owned, and needs
 * to be editable alongside the other Settings JSON blobs. The per-file
 * assignment lives on `files.categoryId`.
 */
export type DocumentCategory = {
  id: string;
  label: string;
  description?: string;
  /** Stages by which a document of this category must exist on the job. */
  requiredByStage?: JobPipelineStage[];
  /** Keep prior uploads instead of replacing them. */
  versioned: boolean;
  /** Customer-portal visibility (Phase 4). */
  customerVisible: boolean;
};

export type DocumentTaxonomyConfig = {
  categories: DocumentCategory[];
  /** Free-form tags offered in the picker; files may also carry ad-hoc tags. */
  suggestedTags: string[];
};

export const DEFAULT_DOCUMENT_TAXONOMY: DocumentTaxonomyConfig = {
  categories: [
    {
      id: 'proposal',
      label: 'Proposal / quote',
      requiredByStage: [JobPipelineStage.QUOTED],
      versioned: true,
      customerVisible: true,
    },
    {
      id: 'contract',
      label: 'Signed contract',
      requiredByStage: [JobPipelineStage.WON],
      versioned: true,
      customerVisible: true,
    },
    {
      id: 'grid_application',
      label: 'Grid / meter application',
      description: 'Pre- and post-meter network paperwork.',
      requiredByStage: [JobPipelineStage.PRE_METER_SUBMITTED],
      versioned: true,
      customerVisible: false,
    },
    {
      id: 'site_survey',
      label: 'Site survey report',
      versioned: false,
      customerVisible: false,
    },
    {
      id: 'swms',
      label: 'SWMS / safety',
      description: 'Safe work method statement.',
      requiredByStage: [JobPipelineStage.SCHEDULED],
      versioned: true,
      customerVisible: false,
    },
    {
      id: 'install_photos',
      label: 'Installation photos',
      requiredByStage: [JobPipelineStage.INSTALLED],
      versioned: false,
      customerVisible: true,
    },
    {
      id: 'compliance',
      label: 'CEC compliance / STC',
      requiredByStage: [JobPipelineStage.COMPLETED],
      versioned: true,
      customerVisible: true,
    },
    {
      id: 'invoice',
      label: 'Invoice / receipt',
      versioned: true,
      customerVisible: true,
    },
    {
      id: 'financing',
      label: 'Financing paperwork',
      versioned: true,
      customerVisible: false,
    },
    {
      id: 'other',
      label: 'Other',
      versioned: false,
      customerVisible: false,
    },
  ],
  suggestedTags: [
    'signed',
    'draft',
    'customer-supplied',
    'network-operator',
    'before',
    'after',
    'warranty',
  ],
};

const ID_PATTERN = /^[a-z0-9_-]+$/i;
const MAX_CATEGORIES = 60;
const MAX_TAGS = 100;
const STAGE_SET = new Set<string>(STAGE_ORDER);

function cloneDefaults(): DocumentTaxonomyConfig {
  return JSON.parse(
    JSON.stringify(DEFAULT_DOCUMENT_TAXONOMY),
  ) as DocumentTaxonomyConfig;
}

function normalizeCategory(raw: unknown): DocumentCategory | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const label = typeof r.label === 'string' ? r.label.trim() : '';
  if (!id || !label) return null;
  const description =
    typeof r.description === 'string' && r.description.trim() !== ''
      ? r.description.trim()
      : undefined;
  const requiredByStage = Array.isArray(r.requiredByStage)
    ? r.requiredByStage.filter(
        (s): s is JobPipelineStage => typeof s === 'string' && STAGE_SET.has(s),
      )
    : undefined;
  return {
    id,
    label,
    ...(description !== undefined ? { description } : {}),
    ...(requiredByStage && requiredByStage.length > 0
      ? { requiredByStage }
      : {}),
    versioned: r.versioned === true,
    customerVisible: r.customerVisible === true,
  };
}

export function mergeDocumentTaxonomy(stored: unknown): DocumentTaxonomyConfig {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return cloneDefaults();
  }
  const s = stored as Record<string, unknown>;
  const categories = Array.isArray(s.categories)
    ? s.categories
        .map(normalizeCategory)
        .filter((c): c is DocumentCategory => c !== null)
    : [];
  if (categories.length === 0) return cloneDefaults();
  return {
    categories,
    suggestedTags: Array.isArray(s.suggestedTags)
      ? s.suggestedTags
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t !== '')
      : [...DEFAULT_DOCUMENT_TAXONOMY.suggestedTags],
  };
}

export function validateDocumentTaxonomy(config: DocumentTaxonomyConfig): void {
  if (!Array.isArray(config.categories) || config.categories.length === 0) {
    throw new BadRequestException(
      'documentTaxonomy.categories must be a non-empty array',
    );
  }
  if (config.categories.length > MAX_CATEGORIES) {
    throw new BadRequestException(
      `documentTaxonomy.categories allows at most ${MAX_CATEGORIES} entries`,
    );
  }
  const seen = new Set<string>();
  for (const category of config.categories) {
    if (
      !category.id ||
      category.id.length > 64 ||
      !ID_PATTERN.test(category.id)
    ) {
      throw new BadRequestException(
        `Category id "${category.id}" must be 1-64 chars of letters, digits, "_" or "-"`,
      );
    }
    if (seen.has(category.id)) {
      throw new BadRequestException(`Duplicate category id "${category.id}"`);
    }
    seen.add(category.id);
    if (!category.label || category.label.length > 120) {
      throw new BadRequestException(
        `Category "${category.id}" label is required (max 120 chars)`,
      );
    }
    for (const stage of category.requiredByStage ?? []) {
      if (!STAGE_SET.has(stage)) {
        throw new BadRequestException(
          `Category "${category.id}" references unknown stage "${stage}"`,
        );
      }
    }
  }
  if (config.suggestedTags.length > MAX_TAGS) {
    throw new BadRequestException(
      `documentTaxonomy.suggestedTags allows at most ${MAX_TAGS} entries`,
    );
  }
}

export function mergeDocumentTaxonomyPatch(
  current: DocumentTaxonomyConfig,
  patch: unknown,
): DocumentTaxonomyConfig {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new BadRequestException('documentTaxonomy must be an object');
  }
  const allowed = new Set(['categories', 'suggestedTags']);
  const unknownKeys = Object.keys(patch).filter((k) => !allowed.has(k));
  if (unknownKeys.length > 0) {
    throw new BadRequestException(
      `Unknown documentTaxonomy key(s): ${unknownKeys.join(', ')}`,
    );
  }
  return mergeDocumentTaxonomy({ ...current, ...patch });
}

/**
 * Categories a job must have on file to legitimately sit at `stage`.
 * A stage requirement applies from that stage onward, so a job that jumped
 * ahead is still reported as missing the earlier paperwork.
 */
export function requiredCategoriesForStage(
  config: DocumentTaxonomyConfig,
  stage: string,
): DocumentCategory[] {
  const stageIndex = STAGE_ORDER.indexOf(stage as JobPipelineStage);
  if (stageIndex < 0) return [];
  return config.categories.filter((category) =>
    (category.requiredByStage ?? []).some(
      (required) => STAGE_ORDER.indexOf(required) <= stageIndex,
    ),
  );
}
