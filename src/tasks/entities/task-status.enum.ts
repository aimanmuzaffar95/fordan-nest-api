export enum TaskStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  BLOCKED = 'blocked',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

/** Statuses that still consume SLA time. */
export const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  TaskStatus.OPEN,
  TaskStatus.IN_PROGRESS,
  TaskStatus.BLOCKED,
];

export enum TaskPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

/** Where the task came from — drives idempotent template materialisation. */
export enum TaskSource {
  MANUAL = 'manual',
  STAGE_TEMPLATE = 'stage_template',
  ALERT = 'alert',
}
