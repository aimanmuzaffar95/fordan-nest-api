/**
 * Zendesk-style ticket lifecycle. `NEW` is the only entry state and, once a
 * complaint leaves it (any other status), it can never return — the service
 * layer enforces that, not the enum itself. `CLOSED` is terminal: the
 * service blocks every further mutation once a complaint reaches it.
 */
export enum ComplaintStatus {
  NEW = 'new',
  OPEN = 'open',
  PENDING = 'pending',
  ON_HOLD = 'on_hold',
  SOLVED = 'solved',
  CLOSED = 'closed',
}

/** Statuses that still count as an open workload item. */
export const ACTIVE_COMPLAINT_STATUSES: ComplaintStatus[] = [
  ComplaintStatus.NEW,
  ComplaintStatus.OPEN,
  ComplaintStatus.PENDING,
  ComplaintStatus.ON_HOLD,
];

export enum ComplaintPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}
