export type JobAuditScalar = string | number | boolean | null;

export type JobAuditObject = {
  [key: string]: JobAuditValue;
};

export type JobAuditArray = JobAuditValue[];

export type JobAuditValue = JobAuditScalar | JobAuditObject | JobAuditArray;
