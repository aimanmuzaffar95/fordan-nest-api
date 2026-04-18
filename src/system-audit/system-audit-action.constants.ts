/** Stable action keys for `system_audit_logs.action` (append-only stream). */
export const SYSTEM_AUDIT_ACTION = {
  ORG_PROFILE_UPDATED: 'org_profile.updated',
  ADMIN_SETTINGS_UPDATED: 'admin_settings.updated',
  AUTH_LOGIN_SUCCESS: 'auth.login_success',
  AUTH_LOGIN_FAILURE: 'auth.login_failure',
} as const;

export type SystemAuditAction =
  (typeof SYSTEM_AUDIT_ACTION)[keyof typeof SYSTEM_AUDIT_ACTION];
