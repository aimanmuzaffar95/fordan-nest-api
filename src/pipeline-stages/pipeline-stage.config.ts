import { BadRequestException } from '@nestjs/common';
import { JobPipelineStage } from '../jobs/job-pipeline-stage.enum';
import { STAGE_ORDER } from '../jobs/pipeline-gate.rules';

/**
 * Admin-configurable pipeline stage templates (PRD v2 roadmap, Phase 0).
 *
 * Scope note: the stage *set* stays the `JobPipelineStage` enum — pipeline
 * gates, reports, alerts and both mobile apps key off those values, and
 * arbitrary custom stages land with the Opportunity/Project split (Phase 3).
 * What is configurable now is everything presentational and operational per
 * stage: label, description, colour, kanban visibility, an SLA budget, and the
 * task templates the Task engine materialises when a job enters the stage.
 */

export type StageTaskAssignee =
  /** `jobs.managerId` */
  | 'manager'
  /** `jobs.assignedStaffUserId` */
  | 'assigned_staff'
  /** whoever moved the job into the stage */
  | 'actor'
  /** leave for triage */
  | 'unassigned';

export type StageTaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export type PipelineStageTaskTemplate = {
  /** Stable id, unique within its stage. Used for idempotent materialisation. */
  id: string;
  title: string;
  description?: string;
  /** Hours after stage entry the task is due. */
  dueOffsetHours: number;
  priority: StageTaskPriority;
  assignTo: StageTaskAssignee;
};

export type PipelineStageConfigItem = {
  /** Must be a `JobPipelineStage` value. */
  id: JobPipelineStage;
  label: string;
  description?: string;
  /** Hex colour used by the kanban column header. */
  color?: string;
  /** Hide the column in the pipeline board (data is untouched). */
  hidden: boolean;
  /**
   * SLA budget for the stage in hours. A job sitting in the stage longer than
   * this breaches; null disables the SLA for the stage.
   */
  slaHours: number | null;
  taskTemplates: PipelineStageTaskTemplate[];
};

export type PipelineStageConfig = {
  stages: PipelineStageConfigItem[];
};

const DEFAULT_LABELS: Record<JobPipelineStage, string> = {
  [JobPipelineStage.LEAD]: 'Lead',
  [JobPipelineStage.QUOTED]: 'Quoted',
  [JobPipelineStage.WON]: 'Won',
  [JobPipelineStage.PRE_METER_SUBMITTED]: 'Pre-meter submitted',
  [JobPipelineStage.PRE_METER_APPROVED]: 'Pre-meter approved',
  [JobPipelineStage.SCHEDULED]: 'Scheduled',
  [JobPipelineStage.INSTALLED]: 'Installed',
  [JobPipelineStage.POST_METER_SUBMITTED]: 'Post-meter submitted',
  [JobPipelineStage.COMPLETED]: 'Completed',
  [JobPipelineStage.INVOICED]: 'Invoiced',
  [JobPipelineStage.PAID]: 'Paid',
};

/**
 * Default SLA budgets, chosen to mirror the thresholds the alert rules already
 * enforce (pre-meter 7d, install warning 3d, post-meter 2d, invoice 14d) so
 * turning the engine on doesn't invent new expectations.
 */
const DEFAULT_SLA_HOURS: Partial<Record<JobPipelineStage, number>> = {
  [JobPipelineStage.LEAD]: 24,
  [JobPipelineStage.QUOTED]: 7 * 24,
  [JobPipelineStage.WON]: 3 * 24,
  [JobPipelineStage.PRE_METER_SUBMITTED]: 7 * 24,
  [JobPipelineStage.PRE_METER_APPROVED]: 7 * 24,
  [JobPipelineStage.SCHEDULED]: 3 * 24,
  [JobPipelineStage.INSTALLED]: 2 * 24,
  [JobPipelineStage.POST_METER_SUBMITTED]: 7 * 24,
  [JobPipelineStage.COMPLETED]: 3 * 24,
  [JobPipelineStage.INVOICED]: 14 * 24,
};

const DEFAULT_TASK_TEMPLATES: Partial<
  Record<JobPipelineStage, PipelineStageTaskTemplate[]>
> = {
  [JobPipelineStage.LEAD]: [
    {
      id: 'lead_first_contact',
      title: 'Make first contact with the lead',
      description: 'Call or email within the response-time SLA.',
      dueOffsetHours: 4,
      priority: 'high',
      assignTo: 'manager',
    },
  ],
  [JobPipelineStage.QUOTED]: [
    {
      id: 'quoted_followup',
      title: 'Follow up on the quote',
      dueOffsetHours: 48,
      priority: 'normal',
      assignTo: 'manager',
    },
  ],
  [JobPipelineStage.WON]: [
    {
      id: 'won_submit_pre_meter',
      title: 'Submit the pre-meter grid application',
      dueOffsetHours: 24,
      priority: 'high',
      assignTo: 'manager',
    },
    {
      id: 'won_collect_deposit',
      title: 'Collect the deposit',
      dueOffsetHours: 72,
      priority: 'normal',
      assignTo: 'manager',
    },
  ],
  [JobPipelineStage.PRE_METER_APPROVED]: [
    {
      id: 'pre_meter_approved_schedule',
      title: 'Schedule the installation',
      dueOffsetHours: 48,
      priority: 'high',
      assignTo: 'manager',
    },
  ],
  [JobPipelineStage.SCHEDULED]: [
    {
      id: 'scheduled_confirm_customer',
      title: 'Confirm the install date with the customer',
      dueOffsetHours: 24,
      priority: 'normal',
      assignTo: 'manager',
    },
    {
      id: 'scheduled_crew_brief',
      title: 'Brief the crew and check equipment availability',
      dueOffsetHours: 24,
      priority: 'normal',
      assignTo: 'assigned_staff',
    },
  ],
  [JobPipelineStage.INSTALLED]: [
    {
      id: 'installed_post_meter',
      title: 'Submit the post-meter application',
      dueOffsetHours: 48,
      priority: 'high',
      assignTo: 'manager',
    },
    {
      id: 'installed_compliance_pack',
      title: 'Complete the CEC compliance pack',
      dueOffsetHours: 72,
      priority: 'normal',
      assignTo: 'assigned_staff',
    },
  ],
  [JobPipelineStage.COMPLETED]: [
    {
      id: 'completed_raise_invoice',
      title: 'Raise the final invoice',
      dueOffsetHours: 24,
      priority: 'high',
      assignTo: 'manager',
    },
  ],
  [JobPipelineStage.INVOICED]: [
    {
      id: 'invoiced_payment_followup',
      title: 'Follow up on payment',
      dueOffsetHours: 14 * 24,
      priority: 'normal',
      assignTo: 'manager',
    },
  ],
};

export function defaultPipelineStageConfig(): PipelineStageConfig {
  return {
    stages: STAGE_ORDER.map((id) => ({
      id,
      label: DEFAULT_LABELS[id],
      hidden: false,
      slaHours: DEFAULT_SLA_HOURS[id] ?? null,
      taskTemplates: (DEFAULT_TASK_TEMPLATES[id] ?? []).map((t) => ({ ...t })),
    })),
  };
}

const STAGE_ID_SET = new Set<string>(STAGE_ORDER);
const PRIORITIES: StageTaskPriority[] = ['low', 'normal', 'high', 'urgent'];
const ASSIGNEES: StageTaskAssignee[] = [
  'manager',
  'assigned_staff',
  'actor',
  'unassigned',
];
const TEMPLATE_ID_PATTERN = /^[a-z0-9_-]+$/i;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const MAX_TEMPLATES_PER_STAGE = 20;
const MAX_SLA_HOURS = 365 * 24;

function normalizeTemplate(raw: unknown): PipelineStageTaskTemplate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  if (!id || !title) return null;
  const description =
    typeof r.description === 'string' && r.description.trim() !== ''
      ? r.description.trim()
      : undefined;
  const dueOffsetHours = Number(r.dueOffsetHours);
  const priority = PRIORITIES.includes(r.priority as StageTaskPriority)
    ? (r.priority as StageTaskPriority)
    : 'normal';
  const assignTo = ASSIGNEES.includes(r.assignTo as StageTaskAssignee)
    ? (r.assignTo as StageTaskAssignee)
    : 'manager';
  return {
    id,
    title,
    ...(description !== undefined ? { description } : {}),
    dueOffsetHours: Number.isFinite(dueOffsetHours)
      ? Math.round(dueOffsetHours)
      : 24,
    priority,
    assignTo,
  };
}

function normalizeStage(
  raw: unknown,
  fallback: PipelineStageConfigItem,
): PipelineStageConfigItem {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  const r = raw as Record<string, unknown>;
  const label =
    typeof r.label === 'string' && r.label.trim() !== ''
      ? r.label.trim()
      : fallback.label;
  const description =
    typeof r.description === 'string' && r.description.trim() !== ''
      ? r.description.trim()
      : undefined;
  const color =
    typeof r.color === 'string' && r.color.trim() !== ''
      ? r.color.trim()
      : undefined;
  const slaRaw = r.slaHours;
  const slaHours =
    slaRaw === null
      ? null
      : Number.isFinite(Number(slaRaw))
        ? Math.round(Number(slaRaw))
        : fallback.slaHours;
  const taskTemplates = Array.isArray(r.taskTemplates)
    ? r.taskTemplates
        .map(normalizeTemplate)
        .filter((t): t is PipelineStageTaskTemplate => t !== null)
    : fallback.taskTemplates;
  return {
    id: fallback.id,
    label,
    ...(description !== undefined ? { description } : {}),
    ...(color !== undefined ? { color } : {}),
    hidden: r.hidden === true,
    slaHours,
    taskTemplates,
  };
}

/** Merge stored JSON with code defaults (forward-compatible). */
export function mergePipelineStageConfig(stored: unknown): PipelineStageConfig {
  const defaults = defaultPipelineStageConfig();
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return defaults;
  }
  const rawStages = (stored as Record<string, unknown>).stages;
  if (!Array.isArray(rawStages)) return defaults;

  const byId = new Map<string, unknown>();
  for (const raw of rawStages) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const id = (raw as Record<string, unknown>).id;
      if (typeof id === 'string' && STAGE_ID_SET.has(id)) byId.set(id, raw);
    }
  }
  // Canonical enum order is authoritative — stored order can't reorder gates.
  return {
    stages: defaults.stages.map((fallback) =>
      normalizeStage(byId.get(fallback.id), fallback),
    ),
  };
}

export function validatePipelineStageConfig(config: PipelineStageConfig): void {
  if (!Array.isArray(config.stages) || config.stages.length === 0) {
    throw new BadRequestException(
      'pipelineStageConfig.stages must be a non-empty array',
    );
  }
  const seen = new Set<string>();
  for (const stage of config.stages) {
    if (!STAGE_ID_SET.has(stage.id)) {
      throw new BadRequestException(`Unknown pipeline stage "${stage.id}"`);
    }
    if (seen.has(stage.id)) {
      throw new BadRequestException(`Duplicate pipeline stage "${stage.id}"`);
    }
    seen.add(stage.id);
    if (!stage.label || stage.label.length > 60) {
      throw new BadRequestException(
        `Stage "${stage.id}" label is required (max 60 chars)`,
      );
    }
    if (stage.description !== undefined && stage.description.length > 300) {
      throw new BadRequestException(
        `Stage "${stage.id}" description exceeds 300 chars`,
      );
    }
    if (stage.color !== undefined && !HEX_COLOR_PATTERN.test(stage.color)) {
      throw new BadRequestException(
        `Stage "${stage.id}" color must be a hex colour like #2563eb`,
      );
    }
    if (
      stage.slaHours !== null &&
      (!Number.isInteger(stage.slaHours) ||
        stage.slaHours < 1 ||
        stage.slaHours > MAX_SLA_HOURS)
    ) {
      throw new BadRequestException(
        `Stage "${stage.id}" slaHours must be null or 1–${MAX_SLA_HOURS}`,
      );
    }
    if (stage.taskTemplates.length > MAX_TEMPLATES_PER_STAGE) {
      throw new BadRequestException(
        `Stage "${stage.id}" allows at most ${MAX_TEMPLATES_PER_STAGE} task templates`,
      );
    }
    const seenTemplates = new Set<string>();
    for (const t of stage.taskTemplates) {
      if (!t.id || t.id.length > 64 || !TEMPLATE_ID_PATTERN.test(t.id)) {
        throw new BadRequestException(
          `Task template id "${t.id}" must be 1-64 chars of letters, digits, "_" or "-"`,
        );
      }
      if (seenTemplates.has(t.id)) {
        throw new BadRequestException(
          `Stage "${stage.id}" has duplicate task template id "${t.id}"`,
        );
      }
      seenTemplates.add(t.id);
      if (!t.title || t.title.length > 160) {
        throw new BadRequestException(
          `Task template "${t.id}" title is required (max 160 chars)`,
        );
      }
      if (t.description !== undefined && t.description.length > 500) {
        throw new BadRequestException(
          `Task template "${t.id}" description exceeds 500 chars`,
        );
      }
      if (
        !Number.isInteger(t.dueOffsetHours) ||
        t.dueOffsetHours < 0 ||
        t.dueOffsetHours > MAX_SLA_HOURS
      ) {
        throw new BadRequestException(
          `Task template "${t.id}" dueOffsetHours must be 0–${MAX_SLA_HOURS}`,
        );
      }
    }
  }
}

/** The editor sends whole stage objects; supplied stages replace their entry. */
export function mergePipelineStagePatch(
  current: PipelineStageConfig,
  patch: unknown,
): PipelineStageConfig {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new BadRequestException('pipelineStageConfig must be an object');
  }
  const unknownKeys = Object.keys(patch).filter((k) => k !== 'stages');
  if (unknownKeys.length > 0) {
    throw new BadRequestException(
      `Unknown pipelineStageConfig key(s): ${unknownKeys.join(', ')}`,
    );
  }
  const rawStages = (patch as Record<string, unknown>).stages;
  if (rawStages === undefined) return current;
  if (!Array.isArray(rawStages)) {
    throw new BadRequestException(
      'pipelineStageConfig.stages must be an array',
    );
  }
  for (const raw of rawStages) {
    const id =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>).id
        : undefined;
    if (typeof id !== 'string' || !STAGE_ID_SET.has(id)) {
      throw new BadRequestException(
        `pipelineStageConfig.stages contains an unknown stage id "${String(id)}"`,
      );
    }
  }
  const byId = new Map<string, unknown>(
    rawStages.map((raw) => [String((raw as Record<string, unknown>).id), raw]),
  );
  return {
    stages: current.stages.map((stage) =>
      byId.has(stage.id) ? normalizeStage(byId.get(stage.id), stage) : stage,
    ),
  };
}

export function findStageConfig(
  config: PipelineStageConfig,
  stage: string,
): PipelineStageConfigItem | null {
  return config.stages.find((s) => String(s.id) === stage) ?? null;
}
