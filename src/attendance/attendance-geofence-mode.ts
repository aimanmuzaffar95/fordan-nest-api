export const ATTENDANCE_GEOFENCE_MODES = [
  'off',
  'audit_only',
  'soft',
  'hard',
] as const;

export type AttendanceGeofenceMode = (typeof ATTENDANCE_GEOFENCE_MODES)[number];

export function parseAttendanceGeofenceMode(
  raw: string | null | undefined,
): AttendanceGeofenceMode {
  if (
    raw === 'off' ||
    raw === 'audit_only' ||
    raw === 'soft' ||
    raw === 'hard'
  ) {
    return raw;
  }
  return 'audit_only';
}
