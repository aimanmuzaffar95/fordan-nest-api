export type JobAuditValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JobAuditValue }
  | JobAuditValue[];
