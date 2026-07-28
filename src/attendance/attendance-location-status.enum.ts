export const ATTENDANCE_LOCATION_STATUSES = [
  'captured',
  'low_accuracy',
  'unavailable',
  // Geofence outcome: coordinates were captured but fell outside the job-site
  // radius. This is a first-class, persisted status so the geofence flag
  // (see AttendanceService.toSessionSummary) and the off-site flow can work.
  'off_site',
] as const;

export type AttendanceLocationStatus =
  (typeof ATTENDANCE_LOCATION_STATUSES)[number];
