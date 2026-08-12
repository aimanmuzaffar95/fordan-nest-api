/**
 * Timeline event kinds for a complaint — mirrors the HubSpot help-desk
 * "History" feed: creation, customer-facing replies, internal notes, and the
 * two structured audit kinds (status/assignment changes).
 */
export enum ComplaintEventType {
  CREATED = 'created',
  REPLY = 'reply',
  NOTE = 'note',
  STATUS_CHANGE = 'status_change',
  ASSIGNMENT_CHANGE = 'assignment_change',
}
