export enum JobAuditAction {
  JOB_CREATED = 'job_created',
  JOB_SOFT_DELETED = 'job_soft_deleted',
  JOB_RESTORED = 'job_restored',
  JOB_STATUS_CHANGED = 'job_status_changed',
  PRE_METER_STATUS_CHANGED = 'pre_meter_status_changed',
  POST_METER_STATUS_CHANGED = 'post_meter_status_changed',
  MANAGER_ASSIGNMENT_CHANGED = 'manager_assignment_changed',
  INSTALLER_ASSIGNED = 'installer_assigned',
  INSTALLER_REMOVED = 'installer_removed',
  CONTRACT_SIGNED_CHANGED = 'contract_signed_changed',
  DEPOSIT_PAID_CHANGED = 'deposit_paid_changed',
  INSTALL_DATE_CHANGED = 'install_date_changed',
}
