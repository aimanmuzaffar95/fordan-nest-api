export enum JobSystemType {
  SOLAR = 'solar',
  BATTERY = 'battery',
  BOTH = 'both',
}

export enum JobMeterStatus {
  NOT_STARTED = 'not_started',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum JobStatus {
  LEAD = 'lead',
  QUOTED = 'quoted',
  WON = 'won',
  PRE_METER_SUBMITTED = 'pre_meter_submitted',
  PRE_METER_APPROVED = 'pre_meter_approved',
  SCHEDULED = 'scheduled',
  INSTALLED = 'installed',
  POST_METER_SUBMITTED = 'post_meter_submitted',
  COMPLETED = 'completed',
  INVOICED = 'invoiced',
  PAID = 'paid',
}
