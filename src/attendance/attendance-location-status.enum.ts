export const ATTENDANCE_LOCATION_STATUSES = [
  'captured',
  'low_accuracy',
  'unavailable',
] as const;

export type AttendanceLocationStatus =
  (typeof ATTENDANCE_LOCATION_STATUSES)[number];
